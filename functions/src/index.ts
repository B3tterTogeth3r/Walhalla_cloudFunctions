/* eslint-disable max-len */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {sendReminder} from "./remind";
import {onDrinkCreate} from "./onDrinkCreate";
import {semesterUpdate} from "./semesterUpdate";

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
exports.semesterUpdate = semesterUpdate();

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
/*  */
exports.onDrinkCreate = onDrinkCreate();

/* Sends a push message to all who are signed in and have an account balance below 0 */
exports.sendReminder = sendReminder();
