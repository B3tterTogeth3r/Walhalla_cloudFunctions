/* eslint-disable max-len */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {QueryDocumentSnapshot} from "firebase-functions/lib/providers/firestore";

/**
 * Sends a push message to all who are signed in and have an account balance below 0
 * @return {functions.CloudFunction<functions.Change<DataSnapshot>>} the function
 */
export function onDrinkCreate(): functions.CloudFunction<QueryDocumentSnapshot> {
  return functions.region("europe-west1")
      .firestore
      .document("Semester/{semesterId}/Drink/{drinkId}")
      .onCreate(async (snapshot) => {
        const amount: number = snapshot.data().amount;
        const price: number = snapshot.data().price;
        const id: string = snapshot.data().uid;
        console.log("A drink got created.");
        const ref = admin.database().ref("counter/drink/");
        if (id != "buy") {
          let currentIncome: number = (amount * price);
          await ref.once("value", (snapshot) => {
            // Update value
            currentIncome = currentIncome + snapshot.val().totalIncome;
          }, (errorObject) => {
            console.log("The income read failed: " + errorObject.name);
          });

          let counter = 0;
          await ref.once("value", (snapshot) => {
            // Upgrade counter
            counter = amount + snapshot.val().totalCounter;
          }, (errorObject) => {
            console.log("The count read failed: " + errorObject.name);
          });

          return ref.update({totalIncome: currentIncome, totalCounter: counter});
        } else {
          console.log("somebody bought beer.");
          const expense: number = amount * price;
          let currentExpense = 0;
          await ref.once("value", (snapshot) => {
            currentExpense = expense + snapshot.val().totalExpense;
          }, (errorObject) => {
            console.log("The read failed: " + errorObject.name);
          });
          return ref.update({totalExpense: currentExpense});
        }
      });
}
