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
  try {
      const expenses = await getPersonalExpenses(uid);
      console.log("Spese recuperate:", expenses); // Log delle spese

      if (expenses.length === 0) {
          console.log("Nessuna spesa condivisa da aggiornare.");
          return; 
      }

      for (let i = 0; i < expenses.length; i++) {
          const expense = expenses[i];
          const row = i + 2; // Assumendo che la prima riga sia per le intestazioni
          const range = `Sheet1!A${row}`; // Modifica in base al tuo range
          const value = expense.value;

          if (value !== undefined) {
              await updateCellValue(spreadsheetId, range, value);
          } else {
              console.error(`Valore undefined per la spesa: ${JSON.stringify(expense)}`);
          }
      }

  } catch (error) {
      console.error("Errore durante l'aggiornamento del foglio:", error);
  }
}




async function updateSharedExpensesInSpreadsheet(sharedExpenses) {
  const currentMonthColumn = getColumnForCurrentMonth();
  for (const expense of sharedExpenses) {
    const row = categoryToCellMap[expense.category];
    const cell = `${currentMonthColumn}${row}`;
    
    // Update the shared expense in both sheets (for example, you could aggregate)
    await updateCellValue(SPREADSHEET_ID_YOUR, cell, expense.price); 
    await updateCellValue(SPREADSHEET_ID_MIRANDA, cell, expense.price);
  }
}
async function updatePersonalExpensesInSpreadsheet(personalExpenses, uid) {
  const currentMonthColumn = getColumnForCurrentMonth();
  for (const expense of personalExpenses) {
    const row = categoryToCellMap[expense.category];
    const cell = `${currentMonthColumn}${row}`;
    
    // Determine which spreadsheet to update based on the user's UID
    const spreadsheetId = uid === "jGHeOLzfldMd2Ro8UIU5zn1a2wp2" ? SPREADSHEET_ID_MIRANDA : SPREADSHEET_ID_YOUR;
    
    // Update personal expense in the respective user's sheet
    await updateCellValue(spreadsheetId, cell, expense.price);
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
async function updateCellValue(spreadsheetId, range, value) {
  const request = {
      spreadsheetId: spreadsheetId,
      range: range,
      valueInputOption: "USER_ENTERED",
      resource: {
          values: [[value]], // Assicurati che value non sia undefined
      },
  };

  try {
      await sheets.spreadsheets.values.update(request);
      console.log(`Aggiornato ${range} con valore: ${value}`);
  } catch (error) {
      console.error("Errore durante l'aggiornamento della cella:", error);
  }
}



// Route to get all expenses
// Route to get all expenses
app.get("/api/expenses", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    // Retrieve personal expenses for the user
    const personalExpensesSnapshot = await db
      .collection("expenses")
      .where("uid", "==", uid)
      .get();

    const personalExpenses = [];
    personalExpensesSnapshot.forEach((doc) => {
      personalExpenses.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    // Retrieve shared expenses
    const sharedExpensesSnapshot = await db
      .collection("expenses")
      .where("type", "==", "condivisa")
      .get();

    const sharedExpenses = [];
    sharedExpensesSnapshot.forEach((doc) => {
      sharedExpenses.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    // Accumulate totals for personal expenses
    const categoryTotals = personalExpenses.reduce((totals, expense) => {
      const { category, price, type } = expense;
      const isShared = type === "condivisa";

      if (!totals[category]) totals[category] = { personale: 0, condivisa: 0 };
      totals[category][isShared ? "condivisa" : "personale"] += isShared ? price / 2 : price;

      return totals;
    }, {});

    // If there are personal expenses, update the sheets accordingly
    if (personalExpenses.length > 0) {
      for (const [category, totalTypes] of Object.entries(categoryTotals)) {
        const row = categoryToCellMap[category];
        const currentMonthColumn = getColumnForCurrentMonth();
        const cell = `${currentMonthColumn}${row}`;

        const spreadsheetId = uid === "jGHeOLzfldMd2Ro8UIU5zn1a2wp2" ? SPREADSHEET_ID_MIRANDA : SPREADSHEET_ID_YOUR;

        // Update the sheets
        if (totalTypes.condivisa > 0) {
          await updateCellValue(SPREADSHEET_ID_MIRANDA, cell, totalTypes.condivisa);
          await updateCellValue(SPREADSHEET_ID_YOUR, cell, totalTypes.condivisa);
        }
        if (totalTypes.personale > 0) {
          await updateCellValue(spreadsheetId, cell, totalTypes.personale);
        }
      }
    } else {
      // Only clear personal expense cells if there are no personal expenses
      await clearPersonalExpenseCells(uid);
    }

    // Send back the expenses, including shared expenses
    res.json({ personalExpenses, sharedExpenses });
  } catch (error) {
    if (error.code === "auth/id-token-expired") {
      return res.status(401).send("Token scaduto, aggiorna il token");
    }
    console.error("Error retrieving and syncing expenses:", error);
    res.status(500).send("Server error");
  }
});

// Helper function to clear personal expense cells in the sheets
async function clearPersonalExpenseCells(uid) {
  const currentMonthColumn = getColumnForCurrentMonth();
  for (const category of Object.keys(categoryToCellMap)) {
    const row = categoryToCellMap[category];
    const cell = `${currentMonthColumn}${row}`;
    
    // Reset the value in the user's sheet to 0, but retain shared expenses
    const spreadsheetId = uid === "jGHeOLzfldMd2Ro8UIU5zn1a2wp2" ? SPREADSHEET_ID_MIRANDA : SPREADSHEET_ID_YOUR;
    await updateCellValue(spreadsheetId, cell, 0);
  }
}


// Route to add an expense
// Route to add an expense
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

    const newExpense = {
      uid: uid,
      description: description,
      category: category,
      price: price,
      type: type,
      date: new Date(),
    };
    
    const docRef = await db.collection("expenses").add(newExpense);

    // Update the spreadsheet after adding the expense
    await updateSpreadsheet(uid);

    res.json({ message: "Spesa aggiunta con successo", expenseId: docRef.id });
  } catch (error) {
    console.error("Errore durante l'aggiunta della spesa:", error);
    res.status(500).send("Errore del server");
  }
});





// Route to update an expense
app.put("/api/expenses/edit/:id", async (req, res) => {
  const { id } = req.params;
  const { category, price, type, description } = req.body;
  const token = req.body.token;

  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    const updatedExpense = {
      category: category,
      price: price,
      description: description,
      type: type,
    };

    // Update the expense in Firestore
    await db.collection("expenses").doc(id).update(updatedExpense);

    // Update the spreadsheet after editing the expense
    await updateSpreadsheet(uid);

    res.json({ message: "Spesa aggiornata con successo" });
  } catch (error) {
    console.error("Errore durante l'aggiornamento della spesa:", error);
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
