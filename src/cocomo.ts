import fs from "fs-extra";
import { Mutex } from "await-semaphore";

import path from "path";
import { getRaceResult } from "#/api";

interface BetHistory {
  /** データID */
  dataid: number;

  /** 組番 */
  numberset: string;

  /** 賭け金 */
  bet: number;

  /** オッズ */
  odds: number | null;

  /** レース結果が決定したかどうか */
  isDecision: boolean;
}

interface Cocomo {
  betHistories: BetHistory[];
}

const DIR = "./store";
const PREFIX = "cocomo";
const SUFFIX = "json";
const mutex: Mutex = new Mutex();

function fileName(isSim: boolean): string {
  if (isSim) {
    return path.join(DIR, `${PREFIX}_sim.${SUFFIX}`);
  } else {
    return path.join(DIR, `${PREFIX}.${SUFFIX}`);
  }
}

function writeCocomo(cocomo: Cocomo, isSim: boolean): void {
  fs.mkdirpSync(DIR);
  fs.writeFileSync(fileName(isSim), JSON.stringify(cocomo, null, 2));
}

function readCocomo(isSim: boolean): Cocomo {
  if (fs.existsSync(fileName(isSim))) {
    return JSON.parse(fs.readFileSync(fileName(isSim)).toString());
  } else {
    return { betHistories: [] };
  }
}

export async function initCocomo(isSim: boolean): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const cocomo: Cocomo = {
      betHistories: [],
    };

    writeCocomo(cocomo, isSim);
  } finally {
    release();
  }
}

export async function calcCocomoBet(
  dataid: number,
  numberset: string,
  isSim: boolean
): Promise<number | null> {
  const release: () => void = await mutex.acquire();

  let bet: number | null = null;
  try {
    const defaultBet = 3000;

    const cocomo = readCocomo(isSim);

    let isAllDecisioned = true;
    let allBet = 0;
    for (let i = 0; i < cocomo.betHistories.length; i++) {
      allBet = allBet + cocomo.betHistories[i].bet;
      if (!cocomo.betHistories[i].isDecision) {
        isAllDecisioned = false;
      }
    }

    if (isAllDecisioned) {
      // すべてのレース結果が決定していれば
      if (cocomo.betHistories.length <= 0) {
        bet = defaultBet;
      } else if (cocomo.betHistories.length === 1) {
        bet = cocomo.betHistories[cocomo.betHistories.length - 1].bet;
      } else {
        bet =
          cocomo.betHistories[cocomo.betHistories.length - 2].bet +
          cocomo.betHistories[cocomo.betHistories.length - 1].bet;
      }

      cocomo.betHistories.push({
        dataid: dataid,
        numberset: numberset,
        bet: bet,
        odds: null,
        isDecision: false,
      });

      writeCocomo(cocomo, isSim);
    } else {
      // すべてのレース結果が決定していなければ
      bet = null;
    }
  } finally {
    release();
  }

  return bet;
}

export function pickupNotDecisionBetHistory(cocomo: Cocomo): BetHistory | null {
  for (let i = 0; i < cocomo.betHistories.length; i++) {
    const betHistory = cocomo.betHistories[i];

    if (!betHistory.isDecision) {
      return betHistory;
    }
  }

  return null;
}

export function updateCocomo2(
  cocomo: Cocomo,
  dataid: number,
  numberset: string,
  odds: number | null
): void {
  if (odds !== null && odds >= 2.6) {
    // 2.6倍以上で勝ち
    cocomo.betHistories = [];
  } else {
    for (let i = 0; i < cocomo.betHistories.length; i++) {
      const betHistory = cocomo.betHistories[i];
      if (betHistory.dataid === dataid && betHistory.numberset === numberset) {
        betHistory.odds = odds;
        betHistory.isDecision = true;
      }
    }
  }
}

export async function updateCocomoSim(
  dataid: number,
  numberset: string,
  odds: number | null
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const isSim = true;
    const cocomo = readCocomo(isSim);

    updateCocomo2(cocomo, dataid, numberset, odds);

    writeCocomo(cocomo, isSim);
  } finally {
    release();
  }
}

export async function updateCocomo(session: string): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const isSim = false;
    const cocomo = readCocomo(isSim);

    const betHistory = pickupNotDecisionBetHistory(cocomo);

    if (betHistory !== null) {
      // 結果を取得
      const raceresult = await getRaceResult(session, betHistory.dataid);
      if (raceresult !== undefined) {
        const oddsStr: string | null =
          raceresult[`odds_2t${betHistory.numberset}`];
        const odds: number | null =
          oddsStr === null ? null : parseInt(oddsStr, 10) / 100;

        updateCocomo2(cocomo, betHistory.dataid, betHistory.numberset, odds);

        writeCocomo(cocomo, isSim);
      }
    }
  } finally {
    release();
  }
}
