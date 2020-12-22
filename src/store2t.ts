import fs from "fs-extra";
import { Mutex } from "await-semaphore";

import { Raceresult, getRaceresult } from "#/api";

/**
 * 二連単で負けた分の履歴
 * isDecision が true の場合、結果が確定した。
 */
interface BetHistory {
  dataid: number;
  numberset: string;
  bet: number;
  odds: string | null;
  isDecision: boolean;
}

/**
 * 場所ごとの履歴
 */
interface JcdHistory {
  jcd: number;
  histories: BetHistory[];
}

/**
 * 二連単の負けた履歴
 */
interface Store2t {
  jcdHistories: JcdHistory[];
}

const store2tDir = "./store";
const store2tFileName = `${store2tDir}/store2t.json`;
const mutex: Mutex = new Mutex();

/**
 * 二連単の負けた履歴 を書き込む
 */
function writeStore2t(store2t: Store2t): void {
  fs.mkdirpSync(store2tDir);
  fs.writeFileSync(store2tFileName, JSON.stringify(store2t, null, 2));
}

/**
 * 二連単で負けた履歴 を読み込む
 */
function readStore2t(): Store2t {
  if (fs.existsSync(store2tFileName)) {
    return JSON.parse(fs.readFileSync(store2tFileName).toString());
  } else {
    return { jcdHistories: [] };
  }
}

/**
 * 二連単の賭け金を計算する
 * ココモ法
 */
export async function calc2tBet(
  dataid: number,
  jcd: number,
  numberset: string,
  default2tBet: number
): Promise<number> {
  const release: () => void = await mutex.acquire();

  let bet: number;
  try {
    // ファイルから読み込む
    const store2t: Store2t = readStore2t();

    let jcdHistory: JcdHistory | undefined = undefined;
    for (let i = 0; i < store2t.jcdHistories.length; i++) {
      if (jcd === store2t.jcdHistories[i].jcd) {
        jcdHistory = store2t.jcdHistories[i];
        break;
      }
    }
    if (jcdHistory === undefined) {
      jcdHistory = {
        jcd: jcd,
        histories: [],
      };
      store2t.jcdHistories.push(jcdHistory);
    }

    if (jcdHistory.histories.length <= 0) {
      bet = default2tBet;
    } else if (jcdHistory.histories.length === 1) {
      bet = jcdHistory.histories[jcdHistory.histories.length - 1].bet;
    } else {
      let allBet = 0;
      for (let i = 0; i < jcdHistory.histories.length; i++) {
        allBet = allBet + jcdHistory.histories[i].bet;
      }
      if (allBet > 20000) {
        // 賭け金が 2万円 を超えたら損切り
        bet = default2tBet;
        jcdHistory.histories = [];
      } else {
        bet =
          jcdHistory.histories[jcdHistory.histories.length - 2].bet +
          jcdHistory.histories[jcdHistory.histories.length - 1].bet;
      }
    }

    // 今回の分を追加する
    jcdHistory.histories.push({
      dataid: dataid,
      numberset: numberset,
      bet: bet,
      odds: null,
      isDecision: false,
    });

    // ファイルへ書き込む
    writeStore2t(store2t);
  } finally {
    release();
  }

  // 賭け金を返す
  return bet;
}

/**
 * 二連単で賭けた分の履歴の結果を更新する
 * 結果が勝ちならば履歴をクリアする
 */
export async function updateStore2t(session: string): Promise<void> {
  const release: () => void = await mutex.acquire();

  try {
    // ファイルから読み込む
    const store2t: Store2t = readStore2t();

    for (let i = 0; i < store2t.jcdHistories.length; i++) {
      const jcdHistory: JcdHistory = store2t.jcdHistories[i];

      let isClear = false;
      for (let j = 0; j < jcdHistory.histories.length; j++) {
        const betHistory: BetHistory = jcdHistory.histories[j];

        if (betHistory.isDecision) {
          continue;
        }

        // 結果を取得
        const raceresult: Raceresult | undefined = await getRaceresult(
          session,
          betHistory.dataid
        );
        if (raceresult === undefined) {
          continue;
        }

        // 結果を反映
        betHistory.odds = raceresult[`odds_2t${betHistory.numberset}`];
        betHistory.isDecision = true;

        if (betHistory.odds !== null && parseInt(betHistory.odds, 10) >= 260) {
          // 2.6倍以上で勝ち
          // 勝ったら「負け履歴」を消す
          isClear = true;
        }
      }
      if (isClear) {
        jcdHistory.histories = [];
      }
    }

    // ファイルへ書き込む
    writeStore2t(store2t);
  } finally {
    release();
  }
}
