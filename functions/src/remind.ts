/* eslint-disable max-len */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {DataSnapshot} from "firebase-functions/lib/providers/database";

/**
 * Sends a push message to all who are signed in and have an account balance below 0
 * @return {functions.CloudFunction<functions.Change<DataSnapshot>>} the function
 */
export function sendReminder(): functions.CloudFunction<functions.Change<DataSnapshot>> {
  return functions.region("europe-west1").database.ref("/reminder").onUpdate(async (change) => {
    const after = change.after.val();
    if (after != null && after.send === true) {
      // data got set to true to trigger the function.
      // Set the RT Database back to false
      console.info("Start sending reminders.");
      return await findPersons()
          .finally(() => {
            return reset();
          });
    } else {
      return "done";
    }
  });
}

/**
 * find all persons with a balance below 0
 */
async function findPersons(): Promise<void> {
  admin.firestore().collection("Person").where("balance", "<", 0).get()
      .then(async (snapshot) => {
        if (snapshot.empty) {
          // console.info("findPersons: All persons have payed.");
          return;
        } else {
          snapshot.forEach(async (doc) => {
            /* console.log("findPersons: Person " + doc.data().first_Name + " " + doc.data().last_Name +
              " has a balance of " + doc.data().balance);*/
            const uid = doc.data().uid;
            if (uid === undefined) {
              // console.log("findPersons: uid === undefined");
              return;
            } else {
              await fcm(doc.data())
                  .then(() => {
                    return;
                  });
            }
          });
        }
      }).catch((error) => {
        console.error("findPersons: Finding persons did not work");
        console.error(error.message);
        return;
      });
}

/**
 * Find the users fcm token, format the message according to the users data and send the message.
 * @param {FirebaseFirestore.DocumentData} doc The data of the user
 */
async function fcm(doc: FirebaseFirestore.DocumentData): Promise<void> {
  return await findFCM(doc.uid)
      .then(async (fcmToken) => {
        if (fcmToken !== undefined) {
          const token: string = fcmToken;
          const message: admin.messaging.Message = formatRemindMessage(token, doc.balance);
          console.info("fcm: start send message");
          return await sendReminderMessage(message)
              .then((/* result*/) => {
                return;
              })
              .catch((error) => {
                // printing the error
                console.error("fcm: message did not work");
                console.error(error.message);
                return;
              });
        } else {
          console.log("fcm: fcmToken === undefined ?" + (fcmToken === undefined));
          return;
        }
      });
}

/**
 * Find the fcm code to the given uid, if there is any
 * @param {string} data the uid of the user to send to
 * @return {Promise<string | void>} the fcm token or null
 */
async function findFCM(data: string): Promise<string | void> {
  // console.info("FindFCM for " + data);
  let result;
  await admin.firestore().collection("FCM_Data").where("uid", "==", data).limit(1).get()
      .then((snapshot) => {
        if (snapshot.empty) {
          // console.debug("Person has no current device connected to fcm.");
          return;
        }
        snapshot.forEach((doc) => {
          // console.debug(doc.id, "=>", doc.data().fcm_token);
          result = doc.data().fcm_token;
          return;
        });
      }).catch(() => {
        return;
      });
  // console.log("findFCM: result type: " + (typeof result));
  return result;
}

/**
 * format the fcm message to reminde a user to pay his bills
 * @param {string} fcm the fcm token of the user to send to
 * @param {number} amount the amount the user has to pay
 * @return {admin.messaging.Message} the formatted payload to send to FCM
 */
function formatRemindMessage(fcm: string, amount: number): admin.messaging.Message {
  const title= "Zahlungserinnerung";
  // Format amount into value like "€ X,XX"
  const money = "€ " + amount.toLocaleString("de-DE", {maximumFractionDigits: 2, minimumFractionDigits: 2});
  const message = "Bitte zahle deine Bierrechnung an das Konto der Aktivitas. Es sind noch " + money + " ausstehend.";

  const payload = {
    notification: {
      title: title,
      body: String(message),
    },
    android: {
      notification: {
        // icon: "https://firebasestorage.googleapis.com/v0/b/walhallaapp.appspot.com/o/shields%2Fwappen_round.png?alt=media&token=af696ced-931e-4056-824a-aede2fa358d1",
        clickAction: "balance",
      },
    },
    apns: {
      payload: {
        aps: {
          "mutable-content": 1,
        },
      },
      fcm_options: {
        // image: "https://firebasestorage.googleapis.com/v0/b/walhallaapp.appspot.com/o/shields%2Fwappen_round.png?alt=media&token=af696ced-931e-4056-824a-aede2fa358d1",
      },
    },
    webpush: {
      headers: {
        // image: "https://firebasestorage.googleapis.com/v0/b/walhallaapp.appspot.com/o/shields%2Fwappen_round.png?alt=media&token=af696ced-931e-4056-824a-aede2fa358d1",
      },
    },
    token: fcm,
  };
  return payload;
}

/**
 * Function to send a message to one person
 * @param {admin.messaging.Message} message formatted message
 * @param {string} fcmToken the token to send the message to
 * @return {Promise<void>} nothing
 */
async function sendReminderMessage(message: admin.messaging.Message): Promise<boolean> {
  console.log("sendReminderMessage: Start message send");
  return admin.messaging().send(message)
      .then((/* response */) => {
        // console.log("sendReminderMessage: successfull", response);
        return true;
      }).catch((/* error*/) => {
        // console.error("sendReminderMessage: error: ", error.message);
        return false;
      });
}

/**
 * resets the value in the realtime database.
 * @return {Promise<boolean>} true if successful
 */
async function reset(): Promise<boolean> {
  return admin.database().ref("/reminder").update({send: false})
      .then(() => {
        // console.debug("reset: complete");
        return true;
      })
      .catch((/* error*/) => {
        // console.error("reset: error");
        // console.error(error.message);
        return false;
      });
}
