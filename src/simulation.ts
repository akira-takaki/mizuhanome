import dayjs from "dayjs";

import { Config } from "#/config";
import {
  BetRaceResult,
  BetResult,
  makeBetDayResult,
  readBetDayResult,
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
  addTicket3t2,
} from "#/boatRace";

async function simulation(): Promise<void> {
  const DATE_FORMAT = "YYYY/MM/DD";

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

  // シミュレーションの元になるレースの日付
  const originalDate = dayjs("2021/01/13", DATE_FORMAT);
  const originalBetDayResult = readBetDayResult(originalDate);

  // シミュレーションで書き出すレースの日付
  const simulationDate = dayjs("1999/12/31", DATE_FORMAT);
  const simulationBetDayResult = makeBetDayResult(
    simulationDate,
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

      if (originalBetResult.type === "3t") {
        numbersetInfos3t.push({
          numberset: originalBetResult.numberset,
          powers: originalBetResult.powers,
          percent: originalBetResult.percent,
          odds: originalBetResult.preOdds,
          expectedValue: originalBetResult.expectedValue,
        });
      } else if (originalBetResult.type === "3f") {
        numbersetInfos3f.push({
          numberset: originalBetResult.numberset,
          powers: originalBetResult.powers,
          percent: originalBetResult.percent,
          odds: originalBetResult.preOdds,
          expectedValue: originalBetResult.expectedValue,
        });
      } else if (originalBetResult.type === "2t") {
        numbersetInfos2t.push({
          numberset: originalBetResult.numberset,
          powers: originalBetResult.powers,
          percent: originalBetResult.percent,
          odds: originalBetResult.preOdds,
          expectedValue: originalBetResult.expectedValue,
        });
      } else if (originalBetResult.type === "2f") {
        numbersetInfos2f.push({
          numberset: originalBetResult.numberset,
          powers: originalBetResult.powers,
          percent: originalBetResult.percent,
          odds: originalBetResult.preOdds,
          expectedValue: originalBetResult.expectedValue,
        });
      }
    }

    // 購入する三連単の舟券を追加する
    const ticket3t: Ticket = {
      type: "3t",
      numbers: [],
    };
    addTicket3t2(simulationBetDayResult, numbersetInfos3t, ticket3t);

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

  writeBetDayResult(simulationDate, simulationBetDayResult);
  await tabulateBetDayResult(simulationDate);
  await report(simulationDate);
}

simulation().catch((err) => {
  console.error(err);
  process.exit(1);
});
