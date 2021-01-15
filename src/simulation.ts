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
import { report } from "#/report";
import { NumbersetInfo } from "#/myUtil";
import { Ticket } from "#/api";
import {
  addTicket2f2,
  addTicket2t2,
  addTicket3f2,
  addTicket3t2B,
} from "#/boatRace";

async function simulation2(
  config: Config,
  date: dayjs.Dayjs
): Promise<BetDayResult> {
  // 「日単位の賭け結果」を読み込む
  const originalBetDayResult = readBetDayResult(date);

  // シミュレーション用の「日単位の賭け結果」を作成
  const simulationBetDayResult = makeBetDayResult(
    date,
    config,
    originalBetDayResult.raceCount
  );

  for (let i = 0; i < originalBetDayResult.betRaceResults.length; i++) {
    const originalBetRaceResult = originalBetDayResult.betRaceResults[i];
    const simulationBetRaceResult: BetRaceResult = {
      dataid: originalBetRaceResult.dataid,
      betResults: [],
      isDecision: true,
    };
    simulationBetDayResult.betRaceResults.push(simulationBetRaceResult);

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
    addTicket3t2B(simulationBetDayResult, numbersetInfos3t, ticket3t);

    // 購入する三連複の舟券を追加する
    const ticket3f: Ticket = {
      type: "3f",
      numbers: [],
    };
    addTicket3f2(numbersetInfos3f, ticket3f);

    // 購入する二連単の舟券を追加する
    const ticket2t: Ticket = {
      type: "2t",
      numbers: [],
    };
    addTicket2t2(numbersetInfos2t, ticket2t);

    // 購入する二連複の舟券を追加する
    const ticket2f: Ticket = {
      type: "2f",
      numbers: [],
    };
    addTicket2f2(numbersetInfos2f, ticket2f);

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
        preDividend: bet * originalBetResult.preOdds,
        odds: originalBetResult.odds,
        dividend:
          originalBetResult.odds !== null ? bet * originalBetResult.odds : 0,
      };
      simulationBetRaceResult.betResults.push(simulationBetResult);
    }
  }

  writeBetDayResult(date, simulationBetDayResult, true);
  const tabulatedBetDayResult = await tabulateBetDayResult(date, true);
  await report(date, true);

  return tabulatedBetDayResult;
}

async function simulation(): Promise<void> {
  const config: Config = {
    baseUrl: "",
    email: "",
    accessKey: "",
    capital: 1000000,
    assumedHittingRate: 0.25,
    assumedCollectRate: 1.1,
    assumedAmountPurchasedRate: 0.25,
    assumedEntryRaceCountRate: 0.2,
  };

  // ファイルに保存してある「日単位の賭け結果」の日付配列
  const dateArray = storedBetDayResultDates(false);

  for (let i = 0; i < dateArray.length; i++) {
    const date = dateArray[i];
    const betDayResult = await simulation2(config, date);

    if (betDayResult.nextCapital !== null) {
      config.capital = betDayResult.nextCapital;
    }
  }
}

simulation().catch((err) => {
  console.error(err);
  process.exit(1);
});
