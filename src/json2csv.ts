import fs from "fs-extra";
import { Parser } from "json2csv";
import {
  BetDayResult,
  BetRaceResult,
  BetResult,
  readBetDayResult,
  storedBetDayResultDates,
} from "#/betResult";
import { TicketType } from "#/myUtil";

const DIR = "./csv";
const PREFIX = "raceResult";
const SUFFIX = "csv";

interface CsvData {
  [key: string]: number | string | null;
}

function writeCsv(fileCount: number, betDayResults: BetDayResult[]): void {
  const csvDataList: CsvData[] = [];
  for (let i = 0; i < betDayResults.length; i++) {
    const betDayResult: BetDayResult = betDayResults[i];
    for (let j = 0; j < betDayResult.betRaceResults.length; j++) {
      const betRaceResult: BetRaceResult = betDayResult.betRaceResults[j];

      const csvData: CsvData = {};
      csvData["jcd"] = betRaceResult.raceCardBody.jcd;
      csvData["rno"] = betRaceResult.raceCardBody.rno;
      csvData["nightflag"] = betRaceResult.raceCardBody.nightflag;
      csvData["gradeicon"] = betRaceResult.raceCardBody.gradeicon;
      csvData["koteiflag"] = betRaceResult.raceCardBody.koteiflag;
      csvData["distance"] = betRaceResult.raceCardBody.distance;
      csvData["anteibanflag"] = betRaceResult.raceCardBody.anteibanflag;
      csvData["wave"] = betRaceResult.beforeInfoBody.wave;
      csvData["wind"] = betRaceResult.beforeInfoBody.wind;

      for (let k = 0; k < betRaceResult.betResults.length; k++) {
        const betResult: BetResult = betRaceResult.betResults[k];
        if (betResult.type === "3t") {
          const keyPrefix = betResult.numberset + ".";

          csvData[keyPrefix + "percent"] = betResult.percent;
          csvData[keyPrefix + "preOdds"] = betResult.preOdds;
          csvData[keyPrefix + "expectedValue"] = betResult.expectedValue;
        }
      }

      for (let k = 0; k < betRaceResult.betResults.length; k++) {
        const betResult: BetResult = betRaceResult.betResults[k];

        if (betResult.type === "3t") {
          if (betResult.odds !== null) {
            csvData["numberset"] = betResult.numberset;
            csvData["odds"] = betResult.odds;
          }
        }
      }

      csvDataList.push(csvData);
    }
  }

  const json2csvParser = new Parser();
  const csv = json2csvParser.parse(csvDataList);

  fs.writeFileSync(
    DIR + "/" + PREFIX + "_" + ("000" + fileCount).slice(-3) + "." + SUFFIX,
    csv
  );
}

async function json2csv(): Promise<void> {
  const isSim = false;
  const dateArray = storedBetDayResultDates(isSim);

  const betDayResults: BetDayResult[] = [];
  for (let i = 0; i < dateArray.length; i++) {
    const date = dateArray[i];

    const betDayResult = readBetDayResult(date, isSim);
    betDayResults.push(betDayResult);
  }

  fs.mkdirpSync(DIR);
  let tmpBetDayResults: BetDayResult[] = [];
  let fileCount = 1;
  let dataCount = 0;
  for (let i = 0; i < betDayResults.length; i++) {
    if (dataCount === 10) {
      writeCsv(fileCount, tmpBetDayResults);
      fileCount++;

      tmpBetDayResults = [];
      dataCount = 0;
    }

    tmpBetDayResults.push(betDayResults[i]);
    dataCount++;
  }
  if (tmpBetDayResults.length > 0) {
    writeCsv(fileCount, tmpBetDayResults);
  }
}

json2csv().catch((err) => {
  console.error(err);
  process.exit(1);
});
