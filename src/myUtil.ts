import { Odds, PredictsAll } from "#/api";

/**
 * オッズを取り出す
 *
 * @param type 舟券の種類
 * @param numberset 組番
 * @param odds オッズ情報
 * @return オッズ
 */
export function pickupOdds(
  type: string,
  numberset: string,
  odds: Odds
): number {
  const oddsKey: string = "odds_" + type + numberset;
  return parseFloat(odds[oddsKey]);
}

export const currencyFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
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
 *
 * @param type 舟券の種類
 * @param predictsAll 直前予想全確率
 * @return 指定された舟券の種類の確率配列
 */
export function filteredTypePercent(
  type: string,
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

/**
 * 指定された組番の確率を返す
 *
 * @param numberset 組番
 * @param percents 確率配列
 * @return 確率
 */
export function pickupPercent(numberset: string, percents: Percent[]): number {
  for (let i = 0; i < percents.length; i++) {
    const percent = percents[i];

    if (numberset === percent.numberset) {
      return parseFloat(percent.percent);
    }
  }

  return 0;
}
