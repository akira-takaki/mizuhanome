import fs from "fs-extra";
import { Mutex } from "await-semaphore";

import path from "path";
import { getRaceResult } from "#/api";
import { TicketType } from "#/myUtil";

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

function fileName(type: TicketType, isSim: boolean): string {
  if (isSim) {
    return path.join(DIR, `${PREFIX}_${type}_sim.${SUFFIX}`);
  } else {
    return path.join(DIR, `${PREFIX}_${type}.${SUFFIX}`);
  }
}

function writeCocomo(cocomo: Cocomo, type: TicketType, isSim: boolean): void {
  fs.mkdirpSync(DIR);
  fs.writeFileSync(fileName(type, isSim), JSON.stringify(cocomo, null, 2));
}

function readCocomo(type: TicketType, isSim: boolean): Cocomo {
  if (fs.existsSync(fileName(type, isSim))) {
    return JSON.parse(fs.readFileSync(fileName(type, isSim)).toString());
  } else {
    return { betHistories: [] };
  }
}

export async function initCocomo(
  type: TicketType,
  isSim: boolean
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const cocomo: Cocomo = {
      betHistories: [],
    };

    writeCocomo(cocomo, type, isSim);
  } finally {
    release();
  }
}

/**
 * ココモ法での賭け金の計算
 *
 * @param dataid
 * @param numberset
 * @param type
 * @param isSim
 * @return 賭け金 or null
 */
export async function calcCocomoBet(
  dataid: number,
  numberset: string,
  type: TicketType,
  isSim: boolean
): Promise<number | null> {
  const release: () => void = await mutex.acquire();

  let bet: number | null = null;
  try {
    const defaultBet = 2000;

    const cocomo = readCocomo(type, isSim);

    let isAllDecisioned = true;
    for (let i = 0; i < cocomo.betHistories.length; i++) {
      if (!cocomo.betHistories[i].isDecision) {
        isAllDecisioned = false;
      }
    }

    if (isAllDecisioned) {
      // すべてのレース結果が決定していれば

      // 損切り
      if (cocomo.betHistories.length >= 14) {
        // すでに 14回 負けていたらリセット
        cocomo.betHistories = [];
      }

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

      writeCocomo(cocomo, type, isSim);
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
  let isWin = false;
  for (let i = 0; i < cocomo.betHistories.length; i++) {
    const betHistory = cocomo.betHistories[i];

    if (betHistory.dataid === dataid && betHistory.numberset === numberset) {
      betHistory.odds = odds;
      betHistory.isDecision = true;
      if (odds !== null && odds >= 2.6) {
        // 2.6倍以上で勝ち
        isWin = true;
      }
    }
  }
  if (isWin) {
    cocomo.betHistories = [];
  }
}

export async function updateCocomoSim(
  dataid: number,
  numberset: string,
  odds: number | null,
  type: TicketType
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const isSim = true;
    const cocomo = readCocomo(type, isSim);

    updateCocomo2(cocomo, dataid, numberset, odds);

    writeCocomo(cocomo, type, isSim);
  } finally {
    release();
  }
}

export async function updateCocomo(
  session: string,
  type: TicketType
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const isSim = false;
    const cocomo = readCocomo(type, isSim);

    const betHistory = pickupNotDecisionBetHistory(cocomo);

    if (betHistory !== null) {
      // 結果を取得
      const raceResult = await getRaceResult(session, betHistory.dataid);
      if (raceResult !== undefined) {
        const oddsStr: string | null =
          raceResult[`odds_${type}${betHistory.numberset}`];
        const odds: number | null =
          oddsStr === null ? null : parseInt(oddsStr, 10) / 100;

        updateCocomo2(cocomo, betHistory.dataid, betHistory.numberset, odds);

        writeCocomo(cocomo, type, isSim);
      }
    }
  } finally {
    release();
  }
}
