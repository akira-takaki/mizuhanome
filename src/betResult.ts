import fs from "fs-extra";
import dayjs from "dayjs";
import { Mutex } from "await-semaphore/index";

import { Config } from "#/config";
import { getRaceResult, Odds, PredictsAll, RaceResult, Ticket } from "#/api";
import {
  generateNumbersetInfoOrderByExpectedValue,
  pickupNumbersetInfo,
  TicketType,
} from "#/myUtil";

/**
 * 賭け結果
 */
interface BetResult {
  /** 舟券種類 */
  type: TicketType;

  /** 組番 */
  numberset: string;

  /** パワー */
  powers: number[];

  /** 確率 */
  percent: number;

  /** 賭け金 */
  bet: number;

  /** レース前オッズ */
  preOdds: number;

  /** 期待値 */
  expectedValue: number;

  /** レース前オッズ を元にした 配当金 */
  preDividend: number;

  /** オッズ */
  odds: number | null;

  /** 配当金 */
  dividend: number | null;
}

/**
 * レースの賭け結果
 */
export interface BetRaceResult {
  /** データID */
  dataid: number;

  /** 賭け結果 */
  betResults: BetResult[];

  /** レース結果が決定したかどうか */
  isDecision: boolean;
}

/**
 * パラメータ
 */
export interface Parameter {
  /** 的中率(パーセント) */
  hittingRate: number | null;

  /** 回収金額率(パーセント) */
  collectRate: number | null;

  /** 回収金額 */
  collect: number | null;

  /** 回収率を維持するための1レースの配当金 */
  raceDividend: number | null;

  /** 購入する or 購入した 金額率(パーセント) */
  amountPurchasedRate: number | null;

  /** 購入する or 購入した 金額 */
  amountPurchased: number | null;

  /** 参加する or 参加した レース数率(パーセント) */
  entryRaceCountRate: number | null;

  /** 参加する or 参加した レース数 */
  entryRaceCount: number | null;
}

/**
 * 日単位の賭け結果
 */
export interface BetDayResult {
  /** 日付 */
  date: string;

  /** 日付フォーマット */
  dateFormat: string;

  /** 資金 */
  capital: number;

  /** 1日のレース数 */
  raceCount: number;

  /** 仮定(三連単) */
  assumed3t: Parameter;

  /** 実際(三連単) */
  actual3t: Parameter;

  /** 実際(三連複) */
  actual3f: Parameter;

  /** 実際(二連単) */
  actual2t: Parameter;

  /** 実際(二連複) */
  actual2f: Parameter;

  /** 実際の「回収金額率(パーセント)」(すべての券種を合わせたもの) */
  collectRateAll: number | null;

  /** 実際に「購入した 金額」(すべての券種を合わせたもの) */
  amountPurchasedAll: number | null;

  /** 実際の「回収金額」(すべての券種を合わせたもの) */
  collectAll: number | null;

  /** 『実際の「回収金額」』−『実際に「購入した金額」』の差額 */
  differenceAll: number | null;

  /** 次回の資金 */
  nextCapital: number | null;

  /** レースの賭け結果 */
  betRaceResults: BetRaceResult[];
}

const DIR = "./store";
const PREFIX = `${DIR}/betDayResult`;
const SUFFIX = `json`;
const DATE_FORMAT = "YYYY/MM/DD";
const FILE_NAME_DATE_FORMAT = "YYYYMMDD";
const BACKUP_FILE_NAME_DATE_FORMAT = "YYYYMMDD_HHmm";
const mutex: Mutex = new Mutex();

/**
 * ファイル名を作って返す
 *
 * @param date 日付
 * @param isBackup バックアップかどうか
 */
function makeFileName(date: dayjs.Dayjs, isBackup: boolean): string {
  let dateStr: string;
  if (isBackup) {
    dateStr = date.format(BACKUP_FILE_NAME_DATE_FORMAT);
  } else {
    dateStr = date.format(FILE_NAME_DATE_FORMAT);
  }
  return `${PREFIX}_${dateStr}.${SUFFIX}`;
}

/**
 * 日単位の賭け結果をファイルへ書き出す
 *
 * @param date 日付
 * @param betDayResult 日単位の賭け結果
 * @param isBackup バックアップかどうか
 */
function writeBetDayResult(
  date: dayjs.Dayjs,
  betDayResult: BetDayResult,
  isBackup = false
): void {
  fs.mkdirpSync(DIR);
  const fileName = makeFileName(date, isBackup);
  fs.writeFileSync(fileName, JSON.stringify(betDayResult, null, 2));
}

function createEmptyParameter(): Parameter {
  return {
    hittingRate: null,
    collectRate: null,
    collect: null,
    raceDividend: null,
    amountPurchasedRate: null,
    amountPurchased: null,
    entryRaceCountRate: null,
    entryRaceCount: null,
  };
}

/**
 * 日単位の賭け結果をファイルから読み込む
 *
 * @param date 日付
 * @return 日単位の賭け結果
 */
export function readBetDayResult(date: dayjs.Dayjs): BetDayResult {
  const fileName = makeFileName(date, false);
  const betDayResult: BetDayResult = JSON.parse(
    fs.readFileSync(fileName).toString()
  );

  if (betDayResult.actual3t === undefined) {
    betDayResult.actual3t = createEmptyParameter();
  }
  if (betDayResult.actual3f === undefined) {
    betDayResult.actual3f = createEmptyParameter();
  }
  if (betDayResult.actual2t === undefined) {
    betDayResult.actual2t = createEmptyParameter();
  }
  if (betDayResult.actual2f === undefined) {
    betDayResult.actual2f = createEmptyParameter();
  }

  return betDayResult;
}

/**
 * 設定で指定した値が同じかどうか
 *
 * @param v1 日単位の賭け結果
 * @param v2 日単位の賭け結果
 */
function equalsBetDayResult(v1: BetDayResult, v2: BetDayResult): boolean {
  let isEqual = true;

  if (v1.capital !== v2.capital) {
    isEqual = false;
  }

  if (v1.assumed3t.hittingRate !== v2.assumed3t.hittingRate) {
    isEqual = false;
  }

  if (v1.assumed3t.collectRate !== v2.assumed3t.collectRate) {
    isEqual = false;
  }

  if (v1.assumed3t.amountPurchasedRate !== v2.assumed3t.amountPurchasedRate) {
    isEqual = false;
  }

  if (v1.assumed3t.entryRaceCountRate !== v2.assumed3t.entryRaceCountRate) {
    isEqual = false;
  }

  return isEqual;
}

/**
 * 設定 から 日単位の賭け結果 を作る
 *
 * @param date 日付
 * @param config 設定
 * @param raceCount 1日のレース数
 * @return 日単位の賭け結果
 */
export function makeBetDayResult(
  date: dayjs.Dayjs,
  config: Config,
  raceCount: number
): BetDayResult {
  // 仮定の「購入する金額」
  //   =  「資金」 X  仮定の「購入する金額率(パーセント)」
  const amountPurchased = Math.round(
    config.capital * config.assumedAmountPurchasedRate
  );

  // 仮定の「回収金額」
  //   =  「資金」 X  仮定の「回収金額率(パーセント)」
  const collect = Math.round(amountPurchased * config.assumedCollectRate);

  // 仮定の「参加するレース数」
  //   =  「1日のレース数」 X  仮定の「参加するレース数率(パーセント)」
  const entryRaceCount = Math.round(
    raceCount * config.assumedEntryRaceCountRate
  );

  // 回収率を維持するための1レースの配当金
  //   =  仮定の「回収金額」 ÷ ( 仮定の「参加するレース数」 X  仮定の「的中率(パーセント)」 )
  const raceDividend = Math.round(
    collect / (entryRaceCount * config.assumedHittingRate)
  );

  return {
    date: date.format(DATE_FORMAT),
    dateFormat: DATE_FORMAT,
    capital: config.capital,
    raceCount: raceCount,
    assumed3t: {
      hittingRate: config.assumedHittingRate,
      collectRate: config.assumedCollectRate,
      collect: collect,
      raceDividend: raceDividend,
      amountPurchasedRate: config.assumedAmountPurchasedRate,
      amountPurchased: amountPurchased,
      entryRaceCountRate: config.assumedEntryRaceCountRate,
      entryRaceCount: entryRaceCount,
    },
    actual3t: createEmptyParameter(),
    actual3f: createEmptyParameter(),
    actual2t: createEmptyParameter(),
    actual2f: createEmptyParameter(),
    collectRateAll: null,
    collectAll: null,
    amountPurchasedAll: null,
    differenceAll: null,
    nextCapital: null,
    betRaceResults: [],
  };
}

/**
 * 日単位の券種ごとの賭け結果 の集計
 *
 * @param raceCount 1日のレース数
 * @param capital 資金
 * @param type 券種
 * @param betRaceResults レースの賭け結果
 * @param parameter 券種のパラメータ
 */
function tabulateBetDayResult3(
  raceCount: number,
  capital: number,
  type: TicketType,
  betRaceResults: BetRaceResult[],
  parameter: Parameter
): void {
  // 回収金額
  let collect = 0;

  // 購入した金額
  let amountPurchased = 0;

  // 参加したレース数
  let entryRaceCount = 0;

  // 的中した数
  let hitting = 0;

  for (let i = 0; i < betRaceResults.length; i++) {
    const betRaceResult = betRaceResults[i];

    let hasType = false;
    let isHitting = false;
    for (let j = 0; j < betRaceResult.betResults.length; j++) {
      const betResult = betRaceResult.betResults[j];

      if (betResult.type === type) {
        hasType = true;

        // 「購入した金額」 に 「賭け金」 を加算
        amountPurchased = amountPurchased + betResult.bet;

        if (betResult.dividend !== null) {
          // 「回収金額」 に 「配当金」 を加算
          collect = collect + betResult.dividend;
        }

        if (betResult.odds !== null) {
          isHitting = true;
        }
      }
    }

    if (hasType) {
      // 参加したレース数 を加算
      entryRaceCount++;
    }
    if (isHitting) {
      // 的中した数 を加算
      hitting++;
    }
  }

  // 的中率(パーセント)
  const hittingRate = entryRaceCount > 0 ? hitting / entryRaceCount : 0;

  // 回収金額率(パーセント)
  const collectRate = amountPurchased > 0 ? collect / amountPurchased : 0;

  // 回収率を維持するための1レースの配当金
  //   =  「回収金額」 ÷ ( 「参加したレース数」 X  「的中率(パーセント)」 )
  const raceDividend =
    entryRaceCount * hittingRate > 0
      ? Math.round(collect / (entryRaceCount * hittingRate))
      : 0;

  // 購入した金額率(パーセント)
  const amountPurchasedRate = amountPurchased / capital;

  // 参加したレース数率(パーセント)
  const entryRaceCountRate = entryRaceCount / raceCount;

  parameter.hittingRate = hittingRate;
  parameter.collectRate = collectRate;
  parameter.collect = collect;
  parameter.raceDividend = raceDividend;
  parameter.amountPurchasedRate = amountPurchasedRate;
  parameter.amountPurchased = amountPurchased;
  parameter.entryRaceCountRate = entryRaceCountRate;
  parameter.entryRaceCount = entryRaceCount;
}

/**
 * 日単位の賭け結果 の集計
 *
 * @param betDayResult 日単位の賭け結果
 */
function tabulateBetDayResult2(betDayResult: BetDayResult): void {
  // 三連単の集計
  tabulateBetDayResult3(
    betDayResult.raceCount,
    betDayResult.capital,
    "3t",
    betDayResult.betRaceResults,
    betDayResult.actual3t
  );

  // 三連複の集計
  tabulateBetDayResult3(
    betDayResult.raceCount,
    betDayResult.capital,
    "3f",
    betDayResult.betRaceResults,
    betDayResult.actual3f
  );

  // 二連単の集計
  tabulateBetDayResult3(
    betDayResult.raceCount,
    betDayResult.capital,
    "2t",
    betDayResult.betRaceResults,
    betDayResult.actual2t
  );

  // 二連複の集計
  tabulateBetDayResult3(
    betDayResult.raceCount,
    betDayResult.capital,
    "2f",
    betDayResult.betRaceResults,
    betDayResult.actual2f
  );

  // すべての券種を合わせたもの
  // 実際に「購入した 金額」
  betDayResult.amountPurchasedAll =
    (betDayResult.actual3t.amountPurchased === null
      ? 0
      : betDayResult.actual3t.amountPurchased) +
    (betDayResult.actual3f.amountPurchased === null
      ? 0
      : betDayResult.actual3f.amountPurchased) +
    (betDayResult.actual2t.amountPurchased === null
      ? 0
      : betDayResult.actual2t.amountPurchased) +
    (betDayResult.actual2f.amountPurchased === null
      ? 0
      : betDayResult.actual2f.amountPurchased);

  // 実際の「回収金額」
  betDayResult.collectAll =
    (betDayResult.actual3t.collect === null
      ? 0
      : betDayResult.actual3t.collect) +
    (betDayResult.actual3f.collect === null
      ? 0
      : betDayResult.actual3f.collect) +
    (betDayResult.actual2t.collect === null
      ? 0
      : betDayResult.actual2t.collect) +
    (betDayResult.actual2f.collect === null
      ? 0
      : betDayResult.actual2f.collect);

  // 実際の「回収金額率(パーセント)」
  betDayResult.collectRateAll =
    betDayResult.amountPurchasedAll > 0
      ? betDayResult.collectAll / betDayResult.amountPurchasedAll
      : 0;

  // 『実際の「回収金額」』−『実際に「購入した金額」』の差額
  betDayResult.differenceAll =
    betDayResult.collectAll - betDayResult.amountPurchasedAll;

  // 次回の資金
  betDayResult.nextCapital = betDayResult.capital + betDayResult.differenceAll;
}

/**
 * 日単位の賭け結果 の集計 (ファイルアクセス付き)
 *
 * @param date 日付
 */
export async function tabulateBetDayResult(
  date: dayjs.Dayjs
): Promise<BetDayResult> {
  const release: () => void = await mutex.acquire();

  let betDayResult: BetDayResult;
  try {
    betDayResult = readBetDayResult(date);
    tabulateBetDayResult2(betDayResult);
    writeBetDayResult(date, betDayResult);
  } finally {
    release();
  }

  return betDayResult;
}

/**
 * 日単位の賭け結果 の初期化
 *
 * @param date 日付
 * @param betDayResult 日単位の賭け結果
 */
export async function initBetDayResult(
  date: dayjs.Dayjs,
  betDayResult: BetDayResult
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const fileName = makeFileName(date, false);
    if (fs.existsSync(fileName)) {
      // すでに存在する場合
      const alreadyBetDayResult = readBetDayResult(date);
      if (equalsBetDayResult(betDayResult, alreadyBetDayResult)) {
        // 設定で指定した値が同じ場合
        // すでに存在するものを使うのでなにもしない
      } else {
        // 設定で指定した値が違う場合
        // 集計してバックアップする
        tabulateBetDayResult2(alreadyBetDayResult);
        writeBetDayResult(date, alreadyBetDayResult, true);

        // 新しい値で上書きする
        writeBetDayResult(date, betDayResult);
      }
    } else {
      writeBetDayResult(date, betDayResult);
    }
  } finally {
    release();
  }
}

/**
 * 日単位の賭け結果 に レースの賭け結果 を追加する
 *
 * @param date 日付
 * @param dataid データID
 * @param odds オッズ
 * @param predictsAll 直前予想全確率
 * @param tickets 舟券
 */
export async function addBetRaceResult(
  date: dayjs.Dayjs,
  dataid: number,
  odds: Odds,
  predictsAll: PredictsAll,
  tickets: Ticket[]
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const betDayResult = readBetDayResult(date);

    const betResults: BetResult[] = [];
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];

      const type = ticket.type;
      const numbersetInfos = generateNumbersetInfoOrderByExpectedValue(
        type,
        predictsAll,
        odds
      );

      for (let j = 0; j < ticket.numbers.length; j++) {
        const ticketNumber = ticket.numbers[j];

        const numberset = ticketNumber.numberset;
        const bet = ticketNumber.bet;

        const numbersetInfo = pickupNumbersetInfo(numberset, numbersetInfos);
        if (numbersetInfo !== undefined) {
          const preDividend = bet * numbersetInfo.odds;

          betResults.push({
            type: type,
            numberset: numberset,
            powers: numbersetInfo.powers,
            percent: numbersetInfo.percent,
            bet: bet,
            preOdds: numbersetInfo.odds,
            expectedValue: numbersetInfo.expectedValue,
            preDividend: preDividend,
            odds: null,
            dividend: null,
          });
        }
      }
    }

    betDayResult.betRaceResults.push({
      dataid: dataid,
      betResults: betResults,
      isDecision: false,
    });

    writeBetDayResult(date, betDayResult);
  } finally {
    release();
  }
}

/**
 * 日単位の賭け結果 の勝敗を更新する
 *
 * @param date
 * @param session
 */
export async function updateBetRaceResult(
  date: dayjs.Dayjs,
  session: string
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const betDayResult = readBetDayResult(date);

    for (let i = 0; i < betDayResult.betRaceResults.length; i++) {
      const betRaceResult = betDayResult.betRaceResults[i];

      if (betRaceResult.isDecision) {
        continue;
      }

      // 結果を取得
      const raceResult: RaceResult | undefined = await getRaceResult(
        session,
        betRaceResult.dataid
      );
      if (raceResult === undefined) {
        continue;
      }

      betRaceResult.isDecision = true;
      for (let j = 0; j < betRaceResult.betResults.length; j++) {
        const betResult = betRaceResult.betResults[j];

        const oddsStr =
          raceResult[`odds_${betResult.type}${betResult.numberset}`];
        if (oddsStr !== null) {
          betResult.odds = parseInt(oddsStr, 10) / 100;
          betResult.dividend = betResult.bet * betResult.odds;
        } else {
          betResult.dividend = 0;
        }
      }
    }

    writeBetDayResult(date, betDayResult);
  } finally {
    release();
  }
}

/**
 * 日単位の賭け結果 でレース結果が決定してないものがあるかどうか
 *
 * @param date
 * @return 決定してないものがあるかどうか
 */
export async function hasNotDecision(date: dayjs.Dayjs): Promise<boolean> {
  const release: () => void = await mutex.acquire();

  let notDecision = false;
  try {
    const betDayResult = readBetDayResult(date);

    for (let i = 0; i < betDayResult.betRaceResults.length; i++) {
      const betRaceResult = betDayResult.betRaceResults[i];

      if (!betRaceResult.isDecision) {
        notDecision = true;
        break;
      }
    }
  } finally {
    release();
  }

  return notDecision;
}
