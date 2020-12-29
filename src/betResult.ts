import fs from "fs-extra";
import dayjs from "dayjs";
import { Mutex } from "await-semaphore/index";

import { getRaceResult, Odds, PredictsAll, RaceResult, Ticket } from "#/api";
import { Config } from "#/main";
import { filteredTypePercent, pickupOdds, pickupPercent } from "#/myUtil";

/**
 * 賭け結果
 */
interface BetResult {
  /** 舟券種類 */
  type: string;

  /** 組番 */
  numberset: string;

  /** 確率 */
  percent: number;

  /** 賭け金 */
  bet: number;

  /** レース前オッズ */
  preOdds: number;

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
interface BetRaceResult {
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
interface Parameter {
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

  /** 仮定 */
  assumed: Parameter;

  /** 実際 */
  actual: Parameter;

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

/**
 * 日単位の賭け結果をファイルから読み込む
 *
 * @param date 日付
 * @return 日単位の賭け結果
 */
function readBetDayResult(date: dayjs.Dayjs): BetDayResult {
  const fileName = makeFileName(date, false);
  return JSON.parse(fs.readFileSync(fileName).toString());
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

  if (v1.assumed.hittingRate !== v2.assumed.hittingRate) {
    isEqual = false;
  }

  if (v1.assumed.collectRate !== v2.assumed.collectRate) {
    isEqual = false;
  }

  if (v1.assumed.amountPurchasedRate !== v2.assumed.amountPurchasedRate) {
    isEqual = false;
  }

  if (v1.assumed.entryRaceCountRate !== v2.assumed.entryRaceCountRate) {
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
    assumed: {
      hittingRate: config.assumedHittingRate,
      collectRate: config.assumedCollectRate,
      collect: collect,
      raceDividend: raceDividend,
      amountPurchasedRate: config.assumedAmountPurchasedRate,
      amountPurchased: amountPurchased,
      entryRaceCountRate: config.assumedEntryRaceCountRate,
      entryRaceCount: entryRaceCount,
    },
    actual: {
      hittingRate: null,
      collectRate: null,
      collect: null,
      raceDividend: null,
      amountPurchasedRate: null,
      amountPurchased: null,
      entryRaceCountRate: null,
      entryRaceCount: null,
    },
    betRaceResults: [],
  };
}

/**
 * 日単位の賭け結果 の集計
 *
 * @param betDayResult 日単位の賭け結果
 */
function tabulateBetDayResult2(betDayResult: BetDayResult): void {
  // 実際に「参加した レース数」
  const entryRaceCount = betDayResult.betRaceResults.length;

  // 実際に「参加した レース数率(パーセント)」
  const entryRaceCountRate = entryRaceCount / betDayResult.raceCount;

  // 実際に「購入した 金額」
  let amountPurchased = 0;

  // 実際の「回収金額」
  let collect = 0;

  // 的中した数
  let hitting = 0;

  for (let i = 0; i < betDayResult.betRaceResults.length; i++) {
    const betRaceResult = betDayResult.betRaceResults[i];

    let isHitting = false;
    for (let j = 0; j < betRaceResult.betResults.length; j++) {
      const betResult = betRaceResult.betResults[j];

      // 実際に「購入した 金額」 に 賭け金 を加算
      amountPurchased = amountPurchased + betResult.bet;

      if (betResult.dividend !== null) {
        // 実際の「回収金額」 に 配当金 を加算
        collect = collect + betResult.dividend;
      }
      if (betResult.odds !== null) {
        isHitting = true;
      }
    }
    if (isHitting) {
      // 的中した数 を加算
      hitting++;
    }
  }

  // 実際に「購入した 金額率(パーセント)」
  const amountPurchasedRate = amountPurchased / betDayResult.capital;

  /** 実際の「回収金額率(パーセント)」 */
  const collectRate = collect / amountPurchased;

  /** 実際の「的中率(パーセント)」 */
  const hittingRate = hitting / entryRaceCount;

  // 回収率を維持するための1レースの配当金
  //   =  実際の「回収金額」 ÷ ( 実際に「参加したレース数」 X  実際の「的中率(パーセント)」 )
  const raceDividend = Math.round(collect / (entryRaceCount * hittingRate));

  betDayResult.actual.entryRaceCount = entryRaceCount;
  betDayResult.actual.entryRaceCountRate = entryRaceCountRate;
  betDayResult.actual.amountPurchased = amountPurchased;
  betDayResult.actual.amountPurchasedRate = amountPurchasedRate;
  betDayResult.actual.collect = collect;
  betDayResult.actual.collectRate = collectRate;
  betDayResult.actual.hittingRate = hittingRate;
  betDayResult.actual.raceDividend = raceDividend;
}

/**
 * 日単位の賭け結果 の集計 (ファイルアクセス付き)
 *
 * @param date 日付
 */
export async function tabulateBetDayResult(date: dayjs.Dayjs): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const betDayResult = readBetDayResult(date);
    tabulateBetDayResult2(betDayResult);
    writeBetDayResult(date, betDayResult);
  } finally {
    release();
  }
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
      const percents = filteredTypePercent(type, predictsAll);

      for (let j = 0; j < ticket.numbers.length; j++) {
        const ticketNumber = ticket.numbers[j];

        const numberset = ticketNumber.numberset;
        const percent = pickupPercent(numberset, percents);
        const bet = ticketNumber.bet;
        const preOdds = pickupOdds(type, numberset, odds);
        const preDividend = bet * preOdds;

        betResults.push({
          type: type,
          numberset: numberset,
          percent: percent,
          bet: bet,
          preOdds: preOdds,
          preDividend: preDividend,
          odds: null,
          dividend: null,
        });
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
