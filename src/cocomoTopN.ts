import fs from "fs-extra";
import path from "path";
import { Mutex } from "await-semaphore";

import { getRaceResult, Ticket } from "#/api";
import { getNow, NumbersetInfo, roundBet, TicketType } from "#/myUtil";
import dayjs from "dayjs";

interface BetNumberset {
  /** 組番 */
  numberset: string;

  /** 賭け金 */
  bet: number;

  /** オッズ */
  odds: number | null;
}

interface BetRace {
  /** 日付 */
  yyyymmdd: string;

  /** データID */
  dataid: number | string;

  /** 賭けた組番 */
  betNumbersetArray: BetNumberset[];

  /** 賭けた組番すべての賭け金合計 */
  allBet: number;

  /** レース結果が決定したかどうか */
  isDecision: boolean;
}

interface Cocomo {
  betRaceArray: BetRace[];
}

const DIR = "./store";
const PREFIX = "cocomoTopN";
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
    return { betRaceArray: [] };
  }
}

export async function initCocomoTopN(
  type: TicketType,
  isSim: boolean
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const cocomo: Cocomo = {
      betRaceArray: [],
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
 * @param numbersetInfoArray 組番情報
 * @param type 舟券種類
 * @param paidOffset 支払ったお金の底上げ分
 * @param maxCount maxCount回数を超えたら損切りする
 * @param wantRate 儲けたいお金の倍率
 * @param limitCount limitCount回数を超えたら「賭けたいお金の倍率」を強制的に 1.0 にする
 * @param ticket 舟券
 * @param isSim
 */
export async function calcCocomoTopNBet(
  yyyymmdd: string,
  dataid: number,
  numbersetInfoArray: NumbersetInfo[],
  type: TicketType,
  paidOffset: number,
  maxCount: number,
  wantRate: number,
  limitCount: number,
  ticket: Ticket,
  isSim: boolean
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const cocomo = readCocomo(type, isSim);

    // すべてのレース結果が決定しているか
    let isAllDecisioned = true;

    for (let i = 0; i < cocomo.betRaceArray.length; i++) {
      const betRace: BetRace = cocomo.betRaceArray[i];

      if (!betRace.isDecision) {
        // すべてのレース結果が決定していない
        isAllDecisioned = false;
      }
    }

    if (isAllDecisioned) {
      // すべてのレース結果が決定していれば

      // 損切り
      if (cocomo.betRaceArray.length > maxCount - 1) {
        // maxCount回数を超えたら損切りする
        cocomo.betRaceArray = [];
      }

      // 支払ったお金
      let paid: number;

      if (cocomo.betRaceArray.length <= 0) {
        // 1回目 は「支払ったお金の底上げ分」
        paid = paidOffset;
      } else {
        // 2回目以降 は「今までに支払ったお金」
        paid = cocomo.betRaceArray
          .map((betRace) => betRace.allBet)
          .reduce(
            (previousValue, currentValue) => previousValue + currentValue
          );
      }

      // 統計の結果から
      let adjustedWantRate = wantRate;
      if (cocomo.betRaceArray.length > limitCount - 1) {
        // limitCount回目を超えたら、賭け金の高騰を防ぐために 1.0 にする。
        // 回収率より、被害が最小になるようにする。
        adjustedWantRate = 1.0;
      }

      // 儲けたいお金
      const want = Math.round(paid * adjustedWantRate);

      const betNumbersetArray: BetNumberset[] = [];
      let allBet = 0;
      for (let i = 0; i < numbersetInfoArray.length; i++) {
        // 予想段階のオッズ
        const preOdds: number =
          numbersetInfoArray[i].odds === null
            ? 1
            : Number(numbersetInfoArray[i].odds);

        // 賭け金を計算
        const bet = roundBet(want / preOdds);

        betNumbersetArray.push({
          numberset: numbersetInfoArray[i].numberset,
          bet: bet,
          odds: null,
        });

        ticket.numbers.push({
          numberset: numbersetInfoArray[i].numberset,
          bet: bet,
        });

        allBet += bet;
      }

      cocomo.betRaceArray.push({
        yyyymmdd: yyyymmdd,
        dataid: dataid,
        betNumbersetArray: betNumbersetArray,
        allBet: allBet,
        isDecision: false,
      });

      writeCocomo(cocomo, type, isSim);
    } else {
      // すべてのレース結果が決定していなければ
      // なにもしない
    }
  } finally {
    release();
  }
}

function pickupNotDecisionBetRace(cocomo: Cocomo): BetRace | null {
  for (let i = 0; i < cocomo.betRaceArray.length; i++) {
    const betRace = cocomo.betRaceArray[i];

    if (!betRace.isDecision) {
      return betRace;
    }
  }

  return null;
}

function updateCocomoTopN2(
  cocomo: Cocomo,
  dataid: number,
  numberset: string,
  odds: number | null
): void {
  let isWin = false;
  for (let i = 0; i < cocomo.betRaceArray.length; i++) {
    const betRace = cocomo.betRaceArray[i];

    // なぜか dataid が文字列になるので、数値にして比較
    if (parseInt(betRace.dataid.toString()) === parseInt(dataid.toString())) {
      for (let j = 0; j < betRace.betNumbersetArray.length; j++) {
        const betNumberset = betRace.betNumbersetArray[j];

        if (betNumberset.numberset === numberset) {
          betNumberset.odds = odds;
          if (odds !== null && odds > 1) {
            isWin = true;
          }
        }
      }
      betRace.isDecision = true;
    }
  }
  if (isWin) {
    cocomo.betRaceArray = [];
  }
}

export async function updateCocomoTopNSim(
  dataid: number,
  numberset: string,
  odds: number | null,
  type: TicketType
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const isSim = true;
    const cocomo = readCocomo(type, isSim);

    updateCocomoTopN2(cocomo, dataid, numberset, odds);

    writeCocomo(cocomo, type, isSim);
  } finally {
    release();
  }
}

export async function updateCocomoTopN(
  session: string,
  type: TicketType
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const isSim = false;
    const cocomo = readCocomo(type, isSim);

    const betRace = pickupNotDecisionBetRace(cocomo);

    if (betRace !== null) {
      // 結果を取得
      const raceResult = await getRaceResult(
        session,
        parseInt(betRace.dataid.toString())
      );
      if (raceResult !== undefined) {
        for (let i = 0; i < betRace.betNumbersetArray.length; i++) {
          const betNumberset = betRace.betNumbersetArray[i];

          const oddsStr: string | null =
            raceResult[`odds_${type}${betNumberset.numberset}`];
          const odds: number | null =
            oddsStr === null ? null : parseInt(oddsStr, 10) / 100;

          updateCocomoTopN2(
            cocomo,
            parseInt(betRace.dataid.toString()),
            betNumberset.numberset,
            odds
          );
        }

        writeCocomo(cocomo, type, isSim);
      } else {
        const now: dayjs.Dayjs = getNow();
        if (now.hour() >= 23) {
          // 23:00 過ぎても結果が取得できなければ強制的に結果を設定する
          for (let i = 0; i < betRace.betNumbersetArray.length; i++) {
            const betNumberset = betRace.betNumbersetArray[i];

            const odds: number | null = null;

            updateCocomoTopN2(
              cocomo,
              parseInt(betRace.dataid.toString()),
              betNumberset.numberset,
              odds
            );
          }

          writeCocomo(cocomo, type, isSim);
        }
      }
    }
  } finally {
    release();
  }
}
