import dayjs from "dayjs";

import {
  readBetDayResult,
  storedBetDayResultDates,
  writeBetDayResult,
} from "#/betResult";
import { Config, readConfig } from "#/config";
import {
  authenticate,
  destroy,
  getBeforeInfo,
  getRaceCard,
  refresh,
  setupApi,
} from "#/api";
import { sleep } from "#/myUtil";

/**
 * 補完処理 日別
 */
async function complementaryOfDay(
  session: string,
  date: dayjs.Dayjs
): Promise<void> {
  console.info(date.toString());

  // 「日単位の賭け結果」を読み込む
  const betDayResult = readBetDayResult(date);

  let isUpdate = false;
  for (let i = 0; i < betDayResult.betRaceResults.length; i++) {
    let isGetRace = false;

    const betRaceResult = betDayResult.betRaceResults[i];

    // 出走表 取得
    if (betRaceResult.raceCardBody === undefined) {
      const raceCard = await getRaceCard(session, betRaceResult.dataid);
      if (raceCard === undefined || raceCard.status !== "200") {
        console.error("can't get RaceCard.");
      } else {
        betRaceResult.raceCardBody = raceCard.body;
        isUpdate = true;
      }
      isGetRace = true;
    }

    // 直前情報 取得
    if (betRaceResult.beforeInfoBody === undefined) {
      const beforeInfo = await getBeforeInfo(session, betRaceResult.dataid);
      if (beforeInfo === undefined || beforeInfo.status !== "200") {
        console.error("can't get BeforeInfo.");
      } else {
        betRaceResult.beforeInfoBody = beforeInfo.body;
        isUpdate = true;
      }
      isGetRace = true;
    }

    if (isGetRace) {
      await sleep(100);
    }
  }

  if (isUpdate) {
    writeBetDayResult(date, betDayResult);
  }
}

/**
 * 補完処理
 */
async function complementary(): Promise<void> {
  console.info("設定ファイルの読み込み");
  let config: Config;
  try {
    config = await readConfig();
  } catch (err) {
    console.error("設定ファイルの読み込み 失敗");
    console.error(err);
    return;
  }

  setupApi(config);

  // 認証
  const session = await authenticate();
  if (session === undefined) {
    console.error("session is undefined");
    return;
  }
  let sessionIntervalId: ReturnType<typeof setInterval> | null = null;

  try {
    sessionIntervalId = setInterval(async () => {
      // セッションの更新 50分ごと
      await refresh(session);
    }, 50 * 60 * 1000);

    // ファイルに保存してある「日単位の賭け結果」の日付配列
    const isSim = false;
    const dateArray = storedBetDayResultDates(isSim);

    for (let i = 0; i < dateArray.length; i++) {
      const date = dateArray[i];

      await complementaryOfDay(session, date);
    }
  } finally {
    if (sessionIntervalId !== null) {
      clearInterval(sessionIntervalId);
    }

    // セッションの破棄
    await destroy(session);
  }
}

complementary().catch((err) => {
  console.error(err);
  process.exit(1);
});
