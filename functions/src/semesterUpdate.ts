/* eslint-disable max-len */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {QueryDocumentSnapshot} from "firebase-functions/lib/providers/firestore";

/**
 * Sends a push message to all who are signed in and have an account balance below 0
 * @return {functions.CloudFunction<functions.Change<DataSnapshot>>} the function
 */
export function semesterUpdate(): functions.CloudFunction<QueryDocumentSnapshot> {
  return functions.region("europe-west1").pubsub.schedule("0 0 1 * *")
      .timeZone("Europe/Berlin")
      .onRun(() =>{
        admin.firestore().doc("Current/Semester").get().then((snapshot) => {
          if (snapshot.exists) {
            const data = snapshot.data();
            if (data !== undefined) {
              const endTime: number = data.end;
              const timeNow = Date.now();

              // End time is in the future
              if (endTime < timeNow) {
                return;
              }

              // Copy new data
              const id: number = data.id +1;
              const path: string = "Semester/" + id;
              admin.firestore().doc(path).get().then(async (snapshot) =>{
                try {
                  if (snapshot.exists) {
                    const data = snapshot.data();
                    if (data == undefined) {
                      return;
                    }
                    const nextSemester: Semester = {
                      begin: data.begin,
                      end: data.end,
                      id: data.id +1,
                      long: data.long,
                      short: data.short,
                    };

                    // Set the new Semester as the current one.
                    await admin.firestore().collection("Current").doc("Semester").set(nextSemester);

                    // save the UID of the chargen into the "Current/Chargen" document
                    await admin.firestore().doc(path).collection("Chargen").limit(5).get().then(async (chargenSnapshot) =>{
                      try {
                        const uids: string[] = [];
                        chargenSnapshot.forEach((charge) =>{
                          const uid = charge.data().uid;
                          if (typeof uid === "string") {
                            uids.push(uid);
                          }
                        });
                        return await admin.firestore().doc("Current/Chargen").set(uids);
                      } catch (err) {
                        console.log("Error on getting current chargia", err);
                        return err;
                      }
                    });

                    // Reset drink counter
                    // Reset account counter
                  }
                } catch (error) {
                  console.log("Downloading the current semesters data did not work.", error);
                  return error;
                }
              });
            }
          }
          return;
        }).catch((exception) =>{
          console.log("Error while checking for new semester: ", exception);
        });
      });
}

interface Semester {
  begin: number;
  end: number;
  id: number;
  long: string;
  short: string;
}
