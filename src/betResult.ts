import fs from "fs-extra";
import dayjs from "dayjs";
import { Mutex } from "await-semaphore/index";

import { getRaceResult, RaceResult, Ticket } from "#/api";
import { Config } from "#/main";

/**
 * 賭け結果
 */
interface BetResult {
  /** 舟券種類 */
  type: string;

  /** 組番 */
  numberset: string;

  /** 賭け金 */
  bet: number;

  /** オッズ */
  odds: string | null;

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
  raceDividend: number;

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
interface BetDayResult {
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
  if (v1.capital !== v2.capital) {
    return false;
  }

  if (v1.assumed.hittingRate !== v2.assumed.hittingRate) {
    return false;
  }

  if (v1.assumed.collectRate !== v2.assumed.collectRate) {
    return false;
  }

  if (v1.assumed.amountPurchasedRate !== v2.assumed.amountPurchasedRate) {
    return false;
  }

  if (v1.assumed.entryRaceCountRate !== v2.assumed.entryRaceCountRate) {
    return false;
  }

  return true;
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
 * 日単位の賭け結果 の集計
 *
 * @param betDayResult 日単位の賭け結果
 */
function tabulateBetDayResult2(betDayResult: BetDayResult): void {
  // TODO
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
 * 日単位の賭け結果 に レースの賭け結果 を追加する
 *
 * @param date 日付
 * @param dataid データID
 * @param tickets 舟券
 */
export async function addBetRaceResult(
  date: dayjs.Dayjs,
  dataid: number,
  tickets: Ticket[]
): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    const betDayResult = readBetDayResult(date);

    const betResults: BetResult[] = [];
    for (let i = 0; i < tickets.length; i++) {
      for (let j = 0; j < tickets[i].numbers.length; j++) {
        betResults.push({
          type: tickets[i].type,
          numberset: tickets[i].numbers[j].numberset,
          bet: tickets[i].numbers[j].bet,
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

        betResult.odds =
          raceResult[`odds_${betResult.type}${betResult.numberset}`];
        if (betResult.odds !== null) {
          betResult.dividend =
            (parseInt(betResult.odds, 10) * betResult.bet) / 100;
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
