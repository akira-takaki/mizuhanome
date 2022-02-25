import dayjs from "dayjs";

import { Config } from "#/config";
import {
  BetDayResult,
  BetRaceResult,
  BetResult,
  makeBetDayResult,
  readBetDayResult,
  storedBetDayResultDates,
  tabulateBetDayResult,
  writeBetDayResult,
} from "#/betResult";
import {
  betMax,
  betMin,
  missCountMax,
  missCountMaxDistributionMap,
  report,
  reportSummary,
} from "#/report";
import {
  currencyFormatter,
  NumbersetInfo,
  playerPowersFromBetRaceResult,
} from "#/myUtil";
import { Ticket } from "#/api";
import { addTicket3f2CocomoTopN, addTicket3t2CocomoTopN } from "#/boatRace";
import { initCocomo, updateCocomoSim } from "#/cocomo";
import { initCocomoTopN, updateCocomoTopNSim } from "#/cocomoTopN";

async function simulation2(
  config: Config,
  date: dayjs.Dayjs
): Promise<BetDayResult> {
  const yyyymmdd = date.format("YYYY-MM-DD");

  // 「日単位の賭け結果」を読み込む
  const originalBetDayResult = readBetDayResult(date);

  // シミュレーション用の「日単位の賭け結果」を作成
  const simulationBetDayResult = makeBetDayResult(
    date,
    config,
    originalBetDayResult.raceCount
  );

  // 今日レースをやるレース場コード
  const todayJcdArray: number[] = Array.from(
    new Set(
      originalBetDayResult.betRaceResults.map((value) =>
        parseInt(value.raceCardBody.jcd.toString())
      )
    )
  );

  for (let i = 0; i < originalBetDayResult.betRaceResults.length; i++) {
    const originalBetRaceResult = originalBetDayResult.betRaceResults[i];
    const simulationBetRaceResult: BetRaceResult = {
      dataid: originalBetRaceResult.dataid,
      raceCardBody: originalBetRaceResult.raceCardBody,
      beforeInfoBody: originalBetRaceResult.beforeInfoBody,
      betResults: [],
      isDecision: true,
    };
    simulationBetDayResult.betRaceResults.push(simulationBetRaceResult);

    // シミュレーション用のプレイヤーのパワー配列を作成
    const powers = playerPowersFromBetRaceResult(originalBetRaceResult);

    // シミュレーション用の組番情報を作成
    const numbersetInfos3t: NumbersetInfo[] = [];
    const numbersetInfos3f: NumbersetInfo[] = [];
    const numbersetInfos2t: NumbersetInfo[] = [];
    const numbersetInfos2f: NumbersetInfo[] = [];
    for (let j = 0; j < originalBetRaceResult.betResults.length; j++) {
      const originalBetResult = originalBetRaceResult.betResults[j];

      const numbersetInfo: NumbersetInfo = {
        numberset: originalBetResult.numberset,
        powers: originalBetResult.powers,
        percent: originalBetResult.percent,
        odds: originalBetResult.preOdds,
        expectedValue: originalBetResult.expectedValue,
      };
      if (originalBetResult.type === "3t") {
        numbersetInfos3t.push(numbersetInfo);
      } else if (originalBetResult.type === "3f") {
        numbersetInfos3f.push(numbersetInfo);
      } else if (originalBetResult.type === "2t") {
        numbersetInfos2t.push(numbersetInfo);
      } else if (originalBetResult.type === "2f") {
        numbersetInfos2f.push(numbersetInfo);
      }
    }

    // 購入する三連単の舟券を追加する
    const ticket3t: Ticket = {
      type: "3t",
      numbers: [],
    };
    // await addTicket3t2CocomoTopN(
    //   yyyymmdd,
    //   simulationBetRaceResult.raceCardBody,
    //   simulationBetRaceResult.beforeInfoBody,
    //   powers,
    //   numbersetInfos3t,
    //   todayJcdArray,
    //   ticket3t,
    //   true
    // );

    // 購入する三連複の舟券を追加する
    const ticket3f: Ticket = {
      type: "3f",
      numbers: [],
    };
    await addTicket3f2CocomoTopN(
      yyyymmdd,
      simulationBetRaceResult.raceCardBody,
      simulationBetRaceResult.beforeInfoBody,
      powers,
      numbersetInfos3f,
      todayJcdArray,
      ticket3f,
      true
    );

    // 購入する二連単の舟券を追加する
    const ticket2t: Ticket = {
      type: "2t",
      numbers: [],
    };
    // await addTicket2t2Cocomo(
    //   yyyymmdd,
    //   simulationBetRaceResult.dataid,
    //   powers,
    //   numbersetInfos2t,
    //   ticket2t,
    //   true
    // );

    // 購入する二連複の舟券を追加する
    const ticket2f: Ticket = {
      type: "2f",
      numbers: [],
    };
    // addTicket2f2(powers, numbersetInfos2f, ticket2f);

    for (let j = 0; j < originalBetRaceResult.betResults.length; j++) {
      const originalBetResult = originalBetRaceResult.betResults[j];

      let bet = 0;
      if (originalBetResult.type === "3t") {
        // 賭け金を取り出す
        for (let k = 0; k < ticket3t.numbers.length; k++) {
          if (originalBetResult.numberset === ticket3t.numbers[k].numberset) {
            bet = ticket3t.numbers[k].bet;
          }
        }
      } else if (originalBetResult.type === "3f") {
        // 賭け金を取り出す
        for (let k = 0; k < ticket3f.numbers.length; k++) {
          if (originalBetResult.numberset === ticket3f.numbers[k].numberset) {
            bet = ticket3f.numbers[k].bet;
          }
        }
      } else if (originalBetResult.type === "2t") {
        // 賭け金を取り出す
        for (let k = 0; k < ticket2t.numbers.length; k++) {
          if (originalBetResult.numberset === ticket2t.numbers[k].numberset) {
            bet = ticket2t.numbers[k].bet;
          }
        }
      } else if (originalBetResult.type === "2f") {
        // 賭け金を取り出す
        for (let k = 0; k < ticket2f.numbers.length; k++) {
          if (originalBetResult.numberset === ticket2f.numbers[k].numberset) {
            bet = ticket2f.numbers[k].bet;
          }
        }
      }

      // レース結果を反映
      const simulationBetResult: BetResult = {
        type: originalBetResult.type,
        numberset: originalBetResult.numberset,
        powers: originalBetResult.powers,
        percent: originalBetResult.percent,
        bet: bet,
        preOdds: originalBetResult.preOdds,
        expectedValue: originalBetResult.expectedValue,
        preDividend:
          originalBetResult.preOdds !== null
            ? bet * originalBetResult.preOdds
            : 0,
        odds: originalBetResult.odds,
        dividend:
          originalBetResult.odds !== null ? bet * originalBetResult.odds : 0,
      };
      simulationBetRaceResult.betResults.push(simulationBetResult);

      // ココモ法の更新
      if (originalBetResult.type === "3t" && bet !== 0) {
        await updateCocomoSim(
          simulationBetRaceResult.dataid,
          originalBetResult.numberset,
          originalBetResult.odds,
          "3t"
        );

        await updateCocomoTopNSim(
          simulationBetRaceResult.dataid,
          originalBetResult.numberset,
          originalBetResult.odds,
          "3t"
        );
      }
      if (originalBetResult.type === "3f" && bet !== 0) {
        await updateCocomoSim(
          simulationBetRaceResult.dataid,
          originalBetResult.numberset,
          originalBetResult.odds,
          "3f"
        );

        await updateCocomoTopNSim(
          simulationBetRaceResult.dataid,
          originalBetResult.numberset,
          originalBetResult.odds,
          "3f"
        );
      }
    }
  }

  const isSim = true;
  writeBetDayResult(date, simulationBetDayResult, isSim);
  const tabulatedBetDayResult = await tabulateBetDayResult(date, isSim);
  await report(date, isSim);

  return tabulatedBetDayResult;
}

async function simulation(): Promise<void> {
  const config: Config = {
    baseUrl: "",
    email: "",
    accessKey: "",
    capital: 0,
    assumedHittingRate: 0.3,
    assumedCollectRate: 1.5,
    assumedAmountPurchasedRate: 0.1,
    assumedEntryRaceCountRate: 0.02,
  };

  // ココモ法 初期化
  await initCocomo("3t", true);
  await initCocomoTopN("3t", true);
  await initCocomo("3f", true);
  await initCocomoTopN("3f", true);

  // ファイルに保存してある「日単位の賭け結果」の日付配列
  let isSim = false;
  let dateArray = storedBetDayResultDates(isSim);

  for (let i = 0; i < dateArray.length; i++) {
    const date = dateArray[i];

    const betDayResult = await simulation2(config, date);

    if (betDayResult.nextCapital !== null) {
      config.capital = betDayResult.nextCapital;
    }
  }

  isSim = true;
  dateArray = storedBetDayResultDates(isSim);
  await reportSummary(dateArray, isSim);

  console.log("賭け金の最小値 betMin=" + currencyFormatter.format(betMin));
  console.log("賭け金の最大値 betMax=" + currencyFormatter.format(betMax));
  console.log("連続ではずれたカウントの最大値 missCountMax=" + missCountMax);
  let totalCount = 0;
  for (let i = 0; i <= missCountMax; i++) {
    totalCount += missCountMaxDistributionMap[i];
  }
  for (let i = 0; i <= missCountMax; i++) {
    const percent = Math.round(
      (missCountMaxDistributionMap[i] / totalCount) * 100
    );
    console.log(
      "missCountMaxDistributionMap[" +
        i +
        "]=" +
        missCountMaxDistributionMap[i] +
        ", " +
        percent +
        "%" +
        " : " +
        (i + 1) +
        "回目"
    );
  }
}

simulation().catch((err) => {
  console.error(err);
  process.exit(1);
});
