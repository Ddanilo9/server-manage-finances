const express = require("express");
const cors = require("cors");
const admin = require("./firebase"); // Ensure Firebase is initialized correctly
const { google } = require("googleapis"); // Google API library
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json()); // To parse JSON request bodies

// Firebase Firestore
const db = admin.firestore();

const credentials = JSON.parse(
  fs.readFileSync(path.join(__dirname, "credentials.json"))
);

// Authenticate via the service account
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// Google Sheets IDs
const SPREADSHEET_ID_YOUR = "1ub7knShEP9zqfnskxUGQIL3sqmPZ-cV_n6Z9VvKLG-0"; // Your sheet ID
const SPREADSHEET_ID_MIRANDA = "1AOjqabjFF4r2lIBtrfDCaYYYEqUcX9HGk8A4GpJKd7E"; // Miranda's sheet ID

// Function to get the column based on the current month
function getColumnForCurrentMonth() {
  const monthToColumnMap = {
    0: "B", // January
    1: "C", // February
    2: "D", // March
    3: "E", // April
    4: "F", // May
    5: "G", // June
    6: "H", // July
    7: "I", // August
    8: "J", // September
    9: "K", // October
    10: "L", // November
    11: "M", // December
  };

  const currentMonth = new Date().getMonth(); // Get the current month (0 for January, 11 for December)
  return monthToColumnMap[currentMonth];
}

// Route to get shared expenses
app.get("/api/expenses/shared", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    const expensesSnapshot = await db
      .collection("expenses")
      .where("type", "==", "condivisa") // Adjust this as per your database structure
      .get();

    const expenses = [];
    expensesSnapshot.forEach((doc) => {
      expenses.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    res.json(expenses); // Ensure the response is an array
  } catch (error) {
    if (error.code === "auth/id-token-expired") {
      return res.status(401).send("Token scaduto, aggiorna il token");
    }
    console.error("Errore durante il recupero delle spese condivise:", error);
    res.status(500).send("Errore del server");
  }
});

// Route to verify user authentication
app.post("/api/auth/verify", async (req, res) => {
  console.log("Richiesta body:", req.body);
  const token = req.body.token;

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    res.json({ uid: decodedToken.uid, email: decodedToken.email });
  } catch (error) {
    console.error("Error verifying token:", error);
    res.status(401).send("Unauthorized");
  }
});

// Category to specific cell mapping for each month
const categoryToCellMap = {
  Affitto: "26",
  Casa: "27",
  "Tel/Digi": "28",
  "Metro/Bus": "31",
  Cibo: "34",
  "Cene/Uscite": "35",
  Vario: "36",
  Shopping: "37",
  Entertainment: "40",
  Palestra: "43",
  Roadtrip: "46",
  Vacanze: "74",
  Commercial: "50",
  "Tax/aut": "51",
  "Tax/varie": "52",
};
async function updateSpreadsheet(uid) {
  // Get shared expenses
  const sharedExpenses = await db.collection("expenses")
    .where("type", "==", "condivisa")
    .get();

  const sharedValues = sharedExpenses.docs.map(doc => doc.data().price);

  // Only update if shared values exist
  if (sharedValues.length > 0) {
    // Update spreadsheet with shared expenses values
    await updateSharedExpensesInSpreadsheet(sharedValues);
  } else {
    console.log("No shared expenses to update.");
  }

  // Handle personal expenses if any exist
  const personalExpenses = await db.collection("expenses")
    .where("uid", "==", uid)
    .get();

  if (personalExpenses.docs.length === 0) {
    console.log("No personal expenses to update.");
    // Optionally clear or reset personal expense cells in the spreadsheet here
  } else {
    // Update spreadsheet with personal expenses values
    await updatePersonalExpensesInSpreadsheet(personalExpenses);
  }
}

// Function to clear sheets
async function clearSheets() {
  const currentMonthColumn = getColumnForCurrentMonth();
  for (const category of Object.keys(categoryToCellMap)) {
    const row = categoryToCellMap[category];
    const cell = `${currentMonthColumn}${row}`;

    // Reset the value in both sheets to 0
    await updateCellValue(SPREADSHEET_ID_YOUR, cell, 0);
    await updateCellValue(SPREADSHEET_ID_MIRANDA, cell, 0);
  }
}

// Function to get the value of a cell
async function getCellValue(spreadsheetId, cell) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Sheet1!${cell}`,
  });
  return response.data.values
    ? parseFloat(response.data.values[0][0].replace(",", ".")) || 0
    : 0;
}

// Function to update the value of a cell
async function updateCellValue(spreadsheetId, cell, newValue) {
  console.log(
    `Updating value in cell ${cell} for spreadsheet ID ${spreadsheetId} with value: ${newValue}`
  );
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Sheet1!${cell}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[newValue]],
    },
  });
}

// Route to get all expenses
app.get("/api/expenses", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = decodedToken.email; // Obtain the user's email

    // Retrieve expenses for the user
    const expensesSnapshot = await db
      .collection("expenses")
      .where("uid", "==", uid)
      .get();

    const expenses = [];
    expensesSnapshot.forEach((doc) => {
      expenses.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    // If there are no expenses, reset the values in the sheets
    if (expenses.length === 0) {
      await clearSheets();
    } else {
      // Accumulate totals for each category and type (shared/personal)
      const categoryTotals = expenses.reduce((totals, expense) => {
        const { category, price, type } = expense;
        const isShared = type === "condivisa";

        if (!totals[category]) totals[category] = { personale: 0, condivisa: 0 };
        totals[category][isShared ? "condivisa" : "personale"] += isShared ? price / 2 : price;

        return totals;
      }, {});

      // Update the sheets with the new values
      for (const [category, totalTypes] of Object.entries(categoryTotals)) {
        const row = categoryToCellMap[category];
        const currentMonthColumn = getColumnForCurrentMonth();
        const cell = `${currentMonthColumn}${row}`;

        // Determine which spreadsheet to update based on user
        const spreadsheetId = email.includes("miranda") ? SPREADSHEET_ID_MIRANDA : SPREADSHEET_ID_YOUR;

        // Sync only shared expenses in Miranda's sheet
        if (totalTypes.condivisa > 0) {
          await updateCellValue(SPREADSHEET_ID_MIRANDA, cell, totalTypes.condivisa); // Update Miranda's sheet

          // Update Danilo's sheet for shared expenses
          await updateCellValue(SPREADSHEET_ID_YOUR, cell, totalTypes.condivisa); // Update Danilo's sheet
        }

        // Sync Danilo's personal expenses
        if (totalTypes.personale > 0) {
          await updateCellValue(spreadsheetId, cell, totalTypes.personale); // Update the correct user's sheet
        }
      }
    }

    res.json(expenses);
  } catch (error) {
    if (error.code === "auth/id-token-expired") {
      return res.status(401).send("Token expired, refresh the token");
    }
    console.error("Error retrieving and syncing expenses:", error);
    res.status(500).send("Server error");
  }
});

// Route to add an expense
app.post("/api/expenses/add", async (req, res) => {
  const { category, price, type, description } = req.body;
  const token = req.body.token;

  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = decodedToken.email; // Assicurati di avere l'email qui

    const shared = type === "condivisa"; // Assicurati che il valore sia booleano
    console.log("Valore di shared:", shared);

    // Create a new expense document in Firestore
    const newExpense = {
      uid: uid,
      description: description,
      category: category,
      price: price,
      type: type,
      date: new Date(),
    };
    
    const docRef = await db.collection("expenses").add(newExpense);
    console.log("Spesa salvata nel database con ID:", docRef.id);

    // Determine which spreadsheet to update based on user
    const spreadsheetId = email.includes("miranda") ? SPREADSHEET_ID_MIRANDA : SPREADSHEET_ID_YOUR;

    // Update the Google Sheets with the new expense
    const row = categoryToCellMap[category]; // Get the row for the category
    const cell = `${getColumnForCurrentMonth()}${row}`;
    
    // Only update the sheet for the user
    await updateCellValue(spreadsheetId, cell, price);

    res.json({ message: "Spesa aggiunta con successo", expenseId: docRef.id });
  } catch (error) {
    console.error("Errore durante l'aggiunta della spesa:", error);
    res.status(500).send("Errore del server");
  }
});

// Route to update an expense
app.put("/api/expenses/edit/:id", async (req, res) => {
  const { id } = req.params;
  const { description, price, category, type } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    console.error("Unauthorized: No token provided");
    return res.status(401).send("Unauthorized: No token provided");
  }

  try {
    console.log(`Verifying token...`);
    const decodedToken = await admin.auth().verifyIdToken(token);
    const expenseRef = db.collection("expenses").doc(id);
    const expenseSnapshot = await expenseRef.get();
    const expenseData = expenseSnapshot.data();
    console.log(`Expense data retrieved:`, expenseData);

    // Verify if the user is authorized to edit the expense
    if (expenseData.uid !== decodedToken.uid) {
      console.error("Unauthorized: User cannot edit this expense");
      return res.status(403).send("Unauthorized: You cannot edit this expense");
    }

    // Store the old category
    const oldCategory = expenseData.category;
    console.log(`Old category: ${oldCategory}`);

    // Determine if the type has changed
    const wasShared = expenseData.type === "condivisa";
    const isNowShared = type === "condivisa";
    console.log(`Expense type changed: wasShared = ${wasShared}, isNowShared = ${isNowShared}`);

    // Update fields based on the request
    const updatedFields = {
      description: description || expenseData.description,
      price: price !== undefined ? price : expenseData.price,
      category: category || expenseData.category,
      type: type || expenseData.type,
      date: new Date(),
    };
    console.log(`Updated fields:`, updatedFields);

    // Update Firestore
    await expenseRef.update(updatedFields);
    console.log(`Expense updated in Firestore.`);

    // Get the current month column
    const currentMonthColumn = getColumnForCurrentMonth();
    const newCategoryRow = categoryToCellMap[category];
    const oldCategoryRow = categoryToCellMap[oldCategory];

    // Array of spreadsheet IDs
    const spreadsheetIds = [
      SPREADSHEET_ID_MIRANDA,
      SPREADSHEET_ID_YOUR, // Make sure to define this ID in your environment
    ];

    // If the category has changed, reset the old category value in the sheets
    if (oldCategory !== category) {
      const oldCell = `${currentMonthColumn}${oldCategoryRow}`;
      for (const spreadsheetId of spreadsheetIds) {
        await updateCellValue(spreadsheetId, oldCell, 0); // Reset old category value to 0
        console.log(`Updating value in cell ${oldCell} for spreadsheet ID ${spreadsheetId} with value: 0`);
      }
    }

    // Update the new category value in the sheets
    const newCell = `${currentMonthColumn}${newCategoryRow}`;
    const newValue = price; // Assuming you want to set the new value to the price
    for (const spreadsheetId of spreadsheetIds) {
      await updateCellValue(spreadsheetId, newCell, newValue);
      console.log(`Updating value in cell ${newCell} for spreadsheet ID ${spreadsheetId} with value: ${newValue}`);
    }

    res.send({ message: "Spesa aggiornata con successo" });
  } catch (error) {
    console.error("Errore durante l'aggiornamento della spesa:", error);
    if (error.code === "auth/id-token-expired") {
      return res.status(401).send("Token scaduto, aggiorna il token");
    }
    res.status(500).send("Errore del server");
  }
});


// Route to delete an expense
app.delete("/api/expenses/delete", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    // Get all expenses for the user
    const expensesSnapshot = await db
      .collection("expenses")
      .where("uid", "==", uid)
      .get();

    // Check if there are expenses to delete
    if (expensesSnapshot.empty) {
      return res.status(404).send("No expenses found to delete.");
    }

    // Prepare batch write to delete all expenses
    const batch = db.batch();
    expensesSnapshot.forEach((doc) => {
      batch.delete(doc.ref);
    });

    // Commit the batch delete
    await batch.commit();
    res.send({ message: "All expenses deleted successfully." });
  } catch (error) {
    console.error("Error deleting expenses:", error);
    if (error.code === "auth/id-token-expired") {
      return res.status(401).send("Token scaduto, aggiorna il token");
    }
    res.status(500).send("Errore del server");
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
