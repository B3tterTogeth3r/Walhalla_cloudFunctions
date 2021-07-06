/* eslint-disable max-len */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

/* go in console to d:\node\
 then enter "firebase deploy"
 to upload changes to firebase cloud functions
 to upload only functions enter "firebase deploy --only functions:'functionName'"
*/

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: "https://walhallaapp.firebaseio.com/",
});

// check at the first of each month for the "Current/Semester" if it is still valid. if not, go one id up and copy the new data.
// If there is a change in semester, copy the uids of the new chargia as an array into the "Current/Chargen" document.
exports.semesterUpdate = functions.region("europe-west1").pubsub.schedule("0 0 1 * *")
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

interface Semester {
  begin: number;
  end: number;
  id: number;
  long: string;
  short: string;
}

exports.onMessageCreate =
functions.region("europe-west1")
    .firestore.document("News/{newsID}").onCreate((create)=>{
      const data = create.data();
      if (data.draft == false) {
        return admin.messaging().send(formatData(data)).then((response) => {
          // Response is a message ID string.
          console.log("Successfully sent message:", response);
        }).catch((error) => {
          console.log("Error sending message:", error);
        });
      } else {
        return null;
      }
    });

exports.onMessageUpdate =
functions.region("europe-west1")
    .firestore.document("News/{newsID}").onUpdate((change) =>{
      const after = change.after.data();
      const before = change.before.data();
      if (change.after.data() == change.before.data()) {
        return null;
      }
      if (before.draft == true && after.draft == false) {
        return admin.messaging().send(formatData(after)).then((response) => {
          // Response is a message ID string.
          console.log("Successfully sent message:", response);
        }).catch((error) => {
          console.log("Error sending message:", error);
        });
      } else {
        return null;
      }
    });

/**
 * format the data to send push messages
 * @param {FirebaseFirestore.DocumentData} data the data to change
 * @return {admin.messaging.Message} the formatted payload to send to FCM
 */
function formatData(data: FirebaseFirestore.DocumentData):admin.messaging.Message {
  const title: string = data.title;
  const content: string = formatArray(data.content);
  let imagePath = "";
  if (typeof data.image == "string") {
    imagePath = data.image;
  }

  let topic = "public";
  if (data.internal == true) {
    topic = "internal";
  }

  const payload = {
    notification: {
      title: title,
      body: String(content),
      image: imagePath,
    },
    android: {
      notification: {
        icon: "wappen_round",
      },
    },
    apns: {
      payload: {
        aps: {
          "mutable-content": 1,
        },
      },
      fcm_options: {
        image: "wappen_round",
      },
    },
    webpush: {
      headers: {
        image: "wappen_round",
      },
    },
    topic: topic,
  };
  return payload;
}

/**
 * Format Array into string and display only the first 100 items
 * @param {string[] | string} data the data written to the database
 * @return {string} the formatted data to send the push message
 */
function formatArray(data: string[] | string): string {
  let returnData = "";
  if (Array.isArray(data)) {
    returnData = data.join(" ");
  } else {
    returnData = data;
  }
  if (returnData.length < 100) {
    returnData = returnData.slice(0, 100);
  }
  return returnData;
}

exports.saveFcmToken =
functions.region("europe-west1")
    .firestore
    .document("Person/{personID}")
    .onWrite(async (change, context) =>{
      const personID = context.params.personID;
      console.log("onWrite in Person at id " + personID);
      const dataAfter = change.after.exists ? change.after.data() : null;
      const dataBefore = change.before.exists ? change.before.data() : null;
      const privatePath = "FCM_Data/" + personID;

      // User got deleted
      if (dataAfter === null && dataBefore !== null && !(typeof dataBefore === "undefined")) {
        // Delete user data from "FCM_Data/{personID}"
        console.log("Deleting person " + dataBefore.first_Name + " " + dataBefore.last_Name);

        // delete items in "FCM_Data/{personID}"
        admin.firestore().doc(privatePath).get().then((snapshot) => {
          if (snapshot.exists) {
            const data = snapshot.data();
            if (data !== undefined) {
              try {
                // remove document
                data.ref.remove;
              } catch (error) {
                console.log("removing the data did not work", error);
                return error;
              }
            }
          }
          return;
        });
      }

      // User signed out so delete data from fcm
      if (dataAfter !== null && dataAfter !== undefined && dataAfter.uid === null) {
        // delete items in "FCM_Data/{personID}"
        admin.firestore().doc(privatePath).get().then((snapshot) => {
          if (snapshot.exists) {
            const data = snapshot.data();
            if (data !== undefined) {
              try {
                // remove document
                data.ref.remove;
              } catch (error) {
                console.log("removing the data did not work", error);
                return error;
              }
            }
          }
          return;
        });
      }

      // User created
      if (dataBefore === null && dataAfter !== null && dataAfter !== undefined) {
        // Create user data in "FCM_Data/{personID}"
        const data: fcmData = {
          fcm_token: dataAfter.fcm_token,
          last_Name: dataAfter.first_Name,
          first_Name: dataAfter.first_Name,
          uid: dataAfter.uid,
        };
        return admin.firestore().doc(privatePath).create(data);
      }

      // Data already there
      if (dataBefore && dataAfter) {
        // check if there is a change in fcm, first_name or the uid
        // Update "FCM_Data/{personID}"
        const data: fcmData = {
          fcm_token: dataAfter.fcm_token,
          last_Name: dataAfter.last_Name,
          first_Name: dataAfter.first_Name,
          uid: dataAfter.uid,
        };
        return admin.firestore().doc(privatePath).update(data);
      }
      return null;
    });

interface fcmData {
  // eslint-disable-next-line camelcase
  fcm_token: string;
  // eslint-disable-next-line camelcase
  last_Name: string;
  // eslint-disable-next-line camelcase
  first_Name: string;
  uid: string;
}

exports.onDrinkCreate =
functions.region("europe-west1")
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

/**
 * Find the fcm code to the given uid, if there is any
 * @param {string} data the uid of the user to send to
 * @return {string} the fcm token or null
 */
function findFCM(data: string): string | null {
  let returnValue: string | null = "";
  console.log("FindFCM for " + data);
  admin.firestore().collection("FCM_Data").where("uid", "==", data).limit(1).get().then((snapshot) => {
    if (snapshot.empty) {
      console.log("Person has no current device connected to fcm.");
      returnValue = null;
    }
    snapshot.forEach((doc) => {
      console.log(doc.id, "=>", doc.data());
      returnValue = doc.data().fcm;
    });
  });
  return returnValue;
}

/**
 * format the fcm message to reminde a user to pay his bills
 * @param {string} fcm the fcm token of the user to send to
 * @param {number} amount the amount the user has to pay
 * @return {admin.messaging.Message} the formatted payload to send to FCM
 */
function formatRemindMessage(fcm: string, amount: number): admin.messaging.MessagingPayload {
  const title= "Erinnerung!";
  // TODO Format amount into value like "€ X,XX"
  const money = "€ " + amount.toLocaleString("de-DE", {maximumFractionDigits: 2, minimumFractionDigits: 2});
  const message = "Bitte zahle deine Bierrechnung an das Konto der Aktivitas. Es sind noch " + money + " ausstehend.";

  const payload = {
    notification: {
      title: title,
      body: String(message),
    },
    android: {
      notification: {
        icon: "wappen_round",
        clickAction: "balance_fragment",
      },
    },
    apns: {
      payload: {
        aps: {
          "mutable-content": 1,
        },
      },
      fcm_options: {
        image: "wappen_round",
      },
    },
    webpush: {
      headers: {
        image: "wappen_round",
      },
    },
    token: fcm,
  };
  return payload;
}

/* Sends a push message to all who are signed in and have an account balance below 0 */
exports.sendReminder =
functions.region("europe-west1").database.ref("/reminder").onUpdate((change) => {
  const after = change.after.val();
  if (after.exists() && after.val().send === true) {
    // data got set to true to trigger the function.
    console.log(after.val().send);
    return findPersons();
    // TODO Set the RT Database back to false
  } else {
    return;
  }
});

/**
 * find all persons with a balance below 0
 */
async function findPersons(): Promise<void> {
  admin.firestore().collection("Person").where("balance", "<", 0).get()
      .then((snapshot) => {
        if (snapshot.empty) {
          return;
        } else {
          snapshot.forEach(async (doc) => {
            console.log("Person " + doc.data().first_Name + " has a balance of " + doc.data().balance);
            const uid = doc.data().uid;
            const fcmToken = findFCM(uid);
            if (typeof fcmToken === "string") {
              const message = formatRemindMessage(fcmToken, doc.data().balance);
              return sendReminderMessage(message, doc.data(), fcmToken);
            } else {
              console.log("Person has no fcmToken");
              return;
            }
          });
        }
      }).catch((error) => {
        console.log(error.message);
      });
}

/**
 * Function to send a message to one person
 * @param {admin.messaging.Message} message formatted message
 * @param {FirebaseFirestore.DocumentData} doc document data to sen
 * @param {string} fcmToken the token to send the message to
 * @return {Promise<void>} nothing
 */
async function sendReminderMessage(message: admin.messaging.MessagingPayload, doc:FirebaseFirestore.DocumentData, fcmToken: string): Promise<void> {
  admin.messaging().sendToDevice(fcmToken, message)
      .then(() => {
        console.log("Successfully send message to " + doc.data().first_Name);
      }).catch((error) => {
        console.log("Error sending message to " + doc.data().first_Name + ":", error);
      });
}
