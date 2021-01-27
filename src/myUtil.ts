import { Odds, PredictsAll } from "#/api";
import { BetRaceResult } from "#/betResult";

export type TicketType = "3t" | "3f" | "2t" | "2f";

/**
 * スリープ
 *
 * @param millisecond
 */
export async function sleep(millisecond: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, millisecond));
}

/**
 * オッズを取り出す
 *
 * @param type 舟券の種類
 * @param numberset 組番
 * @param odds オッズ情報
 * @return オッズ
 */
export function pickupOdds(
  type: TicketType,
  numberset: string,
  odds: Odds
): number | null {
  const oddsKey: string = "odds_" + type + numberset;
  const oddsStr = odds[oddsKey];
  if (oddsStr === undefined || oddsStr === null) {
    return null;
  } else {
    return parseFloat(oddsStr);
  }
}

export const currencyFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
});

export const percentFormatter = new Intl.NumberFormat("ja-JP", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const decimalFormatter = new Intl.NumberFormat("ja-JP", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * 賭け金を100円単位にする
 *
 * @param bet 賭け金
 * @return 100円単位の賭け金
 */
export function roundBet(bet: number): number {
  const r = Math.round(bet / 100) * 100;
  let i = parseInt(r.toString(), 10);
  if (i < 100) {
    i = 100;
  }
  return i;
}

/**
 * 組番と確率
 */
export interface Percent {
  numberset: string;
  percent: string;
}

/**
 * 指定された舟券の種類の確率を取り出す
 * 確率の降順
 *
 * @param type 舟券の種類
 * @param predictsAll 直前予想全確率
 * @return 指定された舟券の種類の確率配列
 */
export function filteredTypePercent(
  type: TicketType,
  predictsAll: PredictsAll
): Percent[] {
  return Object.keys(predictsAll.predict)
    .filter((key) => key.startsWith(type))
    .map(
      (key): Percent => ({
        numberset: key.substring(2),
        percent: predictsAll.predict[key],
      })
    )
    .sort((e1, e2) => {
      if (e1.percent > e2.percent) {
        return 1;
      } else if (e1.percent < e2.percent) {
        return -1;
      } else {
        return 0;
      }
    })
    .reverse();
}

export interface Power {
  numberStr: string;
  power: number;
}

export interface Rough {
  isRough: boolean;
  numberStr: string | null;
}

/**
 * 荒れたレースになりやすいかどうか
 *
 * @param powers
 * @return Rough
 */
export function isRough(powers: Power[]): Rough {
  let is700upCount = 0;
  let is700upNumberStr: string | null = null;
  let is475downCount = 0;
  for (let i = 0; i < powers.length; i++) {
    if (powers[i].power >= 70) {
      is700upCount++;
      is700upNumberStr = powers[i].numberStr;
    } else if (powers[i].power < 47.5) {
      is475downCount++;
    }
  }
  return {
    isRough: is700upCount === 1 && is475downCount === 5,
    numberStr: is700upNumberStr,
  };
}

/**
 * プライヤーのパワー配列の 舟番 で昇順ソート
 *
 * @param e1
 * @param e2
 */
export function playerPowerOrderByNumber(e1: Power, e2: Power): number {
  if (e1.numberStr > e2.numberStr) {
    return 1;
  } else if (e1.numberStr < e2.numberStr) {
    return -1;
  } else {
    return 0;
  }
}

/**
 * プレイヤーのパワー配列を返す
 * シミュレーション用
 *
 * @param betRaceResult
 * @return プレイヤーのパワー配列
 */
export function playerPowersFromBetRaceResult(
  betRaceResult: BetRaceResult
): Power[] {
  const powersMap = new Map<string, number>();
  for (let i = 0; i < betRaceResult.betResults.length; i++) {
    const betResult = betRaceResult.betResults[i];

    for (let j = 0; j < betResult.numberset.length; j++) {
      const numberStr = betResult.numberset.substring(j, j + 1);
      powersMap.set(numberStr, betResult.powers[j]);
    }
  }
  const powers: Power[] = [];
  powersMap.forEach((value, key) =>
    powers.push({ numberStr: key, power: value })
  );
  return powers.sort(playerPowerOrderByNumber);
}

/**
 * プレイヤーのパワー配列を返す
 *
 * @param predictsAll 直前予想全確率
 * @return プレイヤーのパワー配列
 */
export function playerPowers(predictsAll: PredictsAll): Power[] {
  return Object.keys(predictsAll.predict)
    .filter((key) => key.startsWith("player"))
    .map(
      (key): Power => ({
        numberStr: key.substring("player".length, "player".length + 1),
        power: parseFloat(predictsAll.predict[key].toString()),
      })
    )
    .sort(playerPowerOrderByNumber);
}

/**
 * 指定された組番のパワーを返す
 *
 * @param numberset 組番
 * @param predictsAll 直前予想全確率
 * @return 指定された組番のパワー
 */
export function pickupPowers(
  numberset: string,
  predictsAll: PredictsAll
): number[] {
  const powers: number[] = [];

  const allPowers: Power[] = playerPowers(predictsAll);

  for (let i = 0; i < numberset.length; i++) {
    const numberStr = numberset.substring(i, i + 1);
    for (let j = 0; j < allPowers.length; j++) {
      if (numberStr === allPowers[j].numberStr) {
        powers.push(allPowers[j].power);
      }
    }
  }

  return powers;
}

/**
 * 組番情報
 */
export interface NumbersetInfo {
  /** 組番 */
  numberset: string;

  /** パワー */
  powers: number[];

  /** 確率 */
  percent: number;

  /** オッズ */
  odds: number | null;

  /**
   * 期待値 = 確率 x オッズ
   */
  expectedValue: number;
}

/**
 * 組番情報の 期待値 で昇順ソート
 *
 * @param e1
 * @param e2
 */
export function numbersetInfoOrderByExpectedValue(
  e1: NumbersetInfo,
  e2: NumbersetInfo
): number {
  if (e1.expectedValue > e2.expectedValue) {
    return 1;
  } else if (e1.expectedValue < e2.expectedValue) {
    return -1;
  } else {
    return 0;
  }
}

/**
 * 組番情報の 確率 で昇順ソート
 *
 * @param e1
 * @param e2
 * @return number
 */
export function numbersetInfoOrderByPercent(
  e1: NumbersetInfo,
  e2: NumbersetInfo
): number {
  if (e1.percent > e2.percent) {
    return 1;
  } else if (e1.percent < e2.percent) {
    return -1;
  } else {
    return 0;
  }
}

/**
 * 組番情報の オッズ で昇順ソート
 *
 * @param e1
 * @param e2
 * @return number
 */
export function numbersetInfoOrderByOdds(
  e1: NumbersetInfo,
  e2: NumbersetInfo
): number {
  const odds1 = e1.odds === null ? 0 : e1.odds;
  const odds2 = e2.odds === null ? 0 : e2.odds;
  if (odds1 > odds2) {
    return 1;
  } else if (odds1 < odds2) {
    return -1;
  } else {
    return 0;
  }
}

/**
 * 組番情報配列を生成する。
 *
 * @param type 舟券の種類
 * @param predictsAll 直前予想全確率
 * @param odds オッズ情報
 * @return 組番情報配列
 */
export function generateNumbersetInfo(
  type: TicketType,
  predictsAll: PredictsAll,
  odds: Odds
): NumbersetInfo[] {
  const numbersetInfos: NumbersetInfo[] = [];

  // 全組番の確率
  const percents = filteredTypePercent(type, predictsAll);

  for (let i = 0; i < percents.length; i++) {
    const percent: number = parseFloat(percents[i].percent);
    const numbersetOdds = pickupOdds(type, percents[i].numberset, odds);

    numbersetInfos.push({
      numberset: percents[i].numberset,
      powers: pickupPowers(percents[i].numberset, predictsAll),
      percent: percent,
      odds: numbersetOdds,
      expectedValue: numbersetOdds === null ? 0 : percent * numbersetOdds,
    });
  }

  return numbersetInfos;
}

/**
 * 組番情報配列を生成する。
 * 期待値の降順になっている。
 *
 * @param type 舟券の種類
 * @param predictsAll 直前予想全確率
 * @param odds オッズ情報
 * @return 組番情報配列
 */
export function generateNumbersetInfoOrderByExpectedValue(
  type: TicketType,
  predictsAll: PredictsAll,
  odds: Odds
): NumbersetInfo[] {
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 期待値の降順
  return numbersetInfos.sort(numbersetInfoOrderByExpectedValue).reverse();
}

/**
 * 組番情報配列を生成する。
 * 確率の降順になっている。
 *
 * @param type 舟券の種類
 * @param predictsAll 直前予想全確率
 * @param odds オッズ情報
 * @return 組番情報配列
 */
export function generateNumbersetInfoOrderByPercent(
  type: TicketType,
  predictsAll: PredictsAll,
  odds: Odds
): NumbersetInfo[] {
  const numbersetInfos = generateNumbersetInfo(type, predictsAll, odds);

  // 確率の降順
  return numbersetInfos.sort(numbersetInfoOrderByPercent).reverse();
}
