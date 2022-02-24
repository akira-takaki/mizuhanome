import fs from "fs-extra";
import path from "path";
import { Mutex } from "await-semaphore";

import { getRaceResult } from "#/api";
import { getNow, TicketType } from "#/myUtil";
import dayjs from "dayjs";

interface BetHistory {
  /** 日付 */
  yyyymmdd: string;

  /** データID */
  dataid: number | string;

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
 * @param yyyymmdd
 * @param dataid
 * @param numberset
 * @param type
 * @param defaultBet
 * @param maxCount
 * @param isSim
 * @return 賭け金 or null
 */
export async function calcCocomoBet(
  yyyymmdd: string,
  dataid: number,
  numberset: string,
  type: TicketType,
  defaultBet: number,
  maxCount: number,
  isSim: boolean
): Promise<number | null> {
  const release: () => void = await mutex.acquire();

  let bet: number | null = null;
  try {
    const cocomo = readCocomo(type, isSim);

    // すべてのレース結果が決定しているか
    let isAllDecisioned = true;

    for (let i = 0; i < cocomo.betHistories.length; i++) {
      const betHistory: BetHistory = cocomo.betHistories[i];

      if (!betHistory.isDecision) {
        // すべてのレース結果が決定していない
        isAllDecisioned = false;
      }
    }

    if (isAllDecisioned) {
      // すべてのレース結果が決定していれば

      // 損切り
      if (cocomo.betHistories.length >= maxCount) {
        // すでに 指定回数 負けていたらリセット
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
        yyyymmdd: yyyymmdd,
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

function pickupNotDecisionBetHistory(cocomo: Cocomo): BetHistory | null {
  for (let i = 0; i < cocomo.betHistories.length; i++) {
    const betHistory = cocomo.betHistories[i];

    if (!betHistory.isDecision) {
      return betHistory;
    }
  }

  return null;
}

function updateCocomo2(
  cocomo: Cocomo,
  dataid: number,
  numberset: string,
  odds: number | null
): void {
  let isWin = false;
  for (let i = 0; i < cocomo.betHistories.length; i++) {
    const betHistory = cocomo.betHistories[i];

    // なぜか dataid が文字列になるので、数値にして比較
    if (
      parseInt(betHistory.dataid.toString()) === parseInt(dataid.toString()) &&
      betHistory.numberset === numberset
    ) {
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
      const raceResult = await getRaceResult(
        session,
        parseInt(betHistory.dataid.toString())
      );
      if (raceResult !== undefined) {
        const oddsStr: string | null =
          raceResult[`odds_${type}${betHistory.numberset}`];
        const odds: number | null =
          oddsStr === null ? null : parseInt(oddsStr, 10) / 100;

        updateCocomo2(
          cocomo,
          parseInt(betHistory.dataid.toString()),
          betHistory.numberset,
          odds
        );

        writeCocomo(cocomo, type, isSim);
      } else {
        const now: dayjs.Dayjs = getNow();
        if (now.hour() >= 23) {
          // 23:00 過ぎても結果が取得できなければ強制的に結果を設定する
          updateCocomo2(
            cocomo,
            parseInt(betHistory.dataid.toString()),
            betHistory.numberset,
            null
          );

          writeCocomo(cocomo, type, isSim);
        }
      }
    }
  } finally {
    release();
  }
}
