import fs from "fs-extra";
import path from "path";
import { Mutex } from "await-semaphore";

import { getRaceResult, Ticket } from "#/api";
import { getNow, NumbersetInfo, roundBet, TicketType } from "#/myUtil";
import dayjs from "dayjs";
import util from "util";

interface BetNumberset {
  /** 組番 */
  numberset: string;

  /** 賭け金 */
  bet: number;

  /** 賭け単位 */
  num: number;

  /** オッズ */
  odds: number | null;
}

interface BetRace {
  /** 日付 */
  yyyymmdd: string;

  /** データID */
  dataid: number | string;

  /** 賭けた組番 */
  betNumberset: BetNumberset;

  /** レース結果が決定したかどうか */
  isDecision: boolean;
}

interface WinnersInvestmentMethod {
  betRace: BetRace | null;

  /** 記録メモ */
  numArray: number[];

  /** ウィナーズ投資法 実践中 */
  doit: boolean;
}

const initialValueWinnersInvestmentMethod: WinnersInvestmentMethod = {
  betRace: null,
  numArray: [],
  doit: false,
};

const DIR = "./store";
const PREFIX = "winnersInvestmentMethod";
const SUFFIX = "json";
const mutex: Mutex = new Mutex();

function fileName(type: TicketType, isSim: boolean): string {
  if (isSim) {
    return path.join(DIR, `${PREFIX}_${type}_sim.${SUFFIX}`);
  } else {
    return path.join(DIR, `${PREFIX}_${type}.${SUFFIX}`);
  }
}

function writeWinnersInvestmentMethod(
  winnersInvestmentMethod: WinnersInvestmentMethod,
  type: TicketType,
  isSim: boolean
): void {
  fs.mkdirpSync(DIR);
  fs.writeFileSync(
    fileName(type, isSim),
    JSON.stringify(winnersInvestmentMethod, null, 2)
  );
}

function readWinnersInvestmentMethod(
  type: TicketType,
  isSim: boolean
): WinnersInvestmentMethod {
  if (fs.existsSync(fileName(type, isSim))) {
    return JSON.parse(fs.readFileSync(fileName(type, isSim)).toString());
  } else {
    return initialValueWinnersInvestmentMethod;
  }
}

export async function initWinnersInvestmentMethod(
  type: TicketType,
  isSim: boolean
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    writeWinnersInvestmentMethod(
      initialValueWinnersInvestmentMethod,
      type,
      isSim
    );
  } finally {
    release();
  }
}

/**
 * ウィナーズ投資法での賭け金の計算
 *
 * @param yyyymmdd
 * @param dataid
 * @param numbersetInfo 組番情報
 * @param type 舟券種類
 * @param baseBet 基本の賭け金
 * @param ticket 舟券
 * @param isSim
 */
export async function calcWinnersInvestmentMethod(
  yyyymmdd: string,
  dataid: number,
  numbersetInfo: NumbersetInfo,
  type: TicketType,
  baseBet: number,
  ticket: Ticket,
  isSim: boolean
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const winnersInvestmentMethod = readWinnersInvestmentMethod(type, isSim);

    // 前回賭けたレース結果が決定しているか
    let isDecisioned = true;

    const betRace: BetRace | null = winnersInvestmentMethod.betRace;

    if (betRace !== null && !betRace.isDecision) {
      // 前回賭けたレース結果が決定していない
      isDecisioned = false;
    }

    if (isDecisioned) {
      // 前回賭けたレース結果が決定していれば

      let num;
      if (winnersInvestmentMethod.doit) {
        // ウィナーズ投資法 実践中
        // 先頭の「賭け単位」の2倍を賭ける
        num = winnersInvestmentMethod.numArray[0] * 2;
      } else {
        // ウィナーズ投資法 実践前
        num = 1;
      }

      // 賭け金を計算
      const bet = roundBet(baseBet * num);

      ticket.numbers.push({
        numberset: numbersetInfo.numberset,
        bet: bet,
      });

      const betNumberset: BetNumberset = {
        numberset: numbersetInfo.numberset,
        bet: bet,
        num: num,
        odds: null,
      };
      winnersInvestmentMethod.betRace = {
        yyyymmdd: yyyymmdd,
        dataid: dataid,
        betNumberset: betNumberset,
        isDecision: false,
      };

      writeWinnersInvestmentMethod(winnersInvestmentMethod, type, isSim);
    } else {
      // 前回賭けたレース結果が決定していなければ
      // なにもしない
    }
  } finally {
    release();
  }
}

function pickupNotDecisionBetRace(
  winnersInvestmentMethod: WinnersInvestmentMethod
): BetRace | null {
  if (winnersInvestmentMethod.betRace === null) {
    return null;
  } else if (winnersInvestmentMethod.betRace.isDecision) {
    return null;
  } else {
    return winnersInvestmentMethod.betRace;
  }
}

function updateWinnersInvestmentMethod2(
  winnersInvestmentMethod: WinnersInvestmentMethod,
  dataid: number,
  numberset: string,
  odds: number | null
): void {
  const betRace = winnersInvestmentMethod.betRace;
  if (betRace !== null) {
    // なぜか dataid が文字列になるので、数値にして比較
    if (parseInt(betRace.dataid.toString()) === parseInt(dataid.toString())) {
      const betNumberset = betRace.betNumberset;

      if (betNumberset.numberset === numberset) {
        betNumberset.odds = odds;
        if (odds !== null && odds > 1) {
          // 当たったときの処理
          // 先頭の「賭け単位」を一つ消す
          winnersInvestmentMethod.numArray.shift();

          if (winnersInvestmentMethod.numArray.length === 0) {
            // 「賭け単位」がなくなれば、ウィナーズ投資法をリセット
            winnersInvestmentMethod.betRace = null;
            winnersInvestmentMethod.doit = false;
          }
        } else {
          // はずれたときの処理
          // 負けた「賭け単位」を最後に追加する
          winnersInvestmentMethod.numArray.push(betNumberset.num);

          if (
            !winnersInvestmentMethod.doit &&
            winnersInvestmentMethod.numArray.length === 2
          ) {
            // 2連敗後、ウィナーズ投資法を実践
            winnersInvestmentMethod.doit = true;
          }
        }
      }

      betRace.isDecision = true;

      console.log(
        "memoArray=" +
          util.inspect(winnersInvestmentMethod.numArray, false, null, true)
      );
    }
  }
}

export async function updateWinnersInvestmentMethodSim(
  dataid: number,
  numberset: string,
  odds: number | null,
  type: TicketType
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const isSim = true;
    const winnersInvestmentMethod = readWinnersInvestmentMethod(type, isSim);

    updateWinnersInvestmentMethod2(
      winnersInvestmentMethod,
      dataid,
      numberset,
      odds
    );

    writeWinnersInvestmentMethod(winnersInvestmentMethod, type, isSim);
  } finally {
    release();
  }
}

export async function updateWinnersInvestmentMethod(
  session: string,
  type: TicketType
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const isSim = false;
    const winnersInvestmentMethod = readWinnersInvestmentMethod(type, isSim);

    const betRace = pickupNotDecisionBetRace(winnersInvestmentMethod);

    if (betRace !== null) {
      // 結果を取得
      const raceResult = await getRaceResult(
        session,
        parseInt(betRace.dataid.toString())
      );
      if (raceResult !== undefined) {
        const betNumberset = betRace.betNumberset;

        const oddsStr: string | null =
          raceResult[`odds_${type}${betNumberset.numberset}`];
        const odds: number | null =
          oddsStr === null ? null : parseInt(oddsStr, 10) / 100;

        updateWinnersInvestmentMethod2(
          winnersInvestmentMethod,
          parseInt(betRace.dataid.toString()),
          betNumberset.numberset,
          odds
        );

        writeWinnersInvestmentMethod(winnersInvestmentMethod, type, isSim);
      } else {
        const now: dayjs.Dayjs = getNow();
        if (now.hour() >= 23) {
          // 23:00 過ぎても結果が取得できなければ強制的に結果を設定する
          const betNumberset = betRace.betNumberset;

          const odds: number | null = null;

          updateWinnersInvestmentMethod2(
            winnersInvestmentMethod,
            parseInt(betRace.dataid.toString()),
            betNumberset.numberset,
            odds
          );

          writeWinnersInvestmentMethod(winnersInvestmentMethod, type, isSim);
        }
      }
    }
  } finally {
    release();
  }
}
