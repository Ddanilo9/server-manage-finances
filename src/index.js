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
// Funzione per sincronizzare le spese nei fogli di Danilo e Miranda
async function syncExpensesToSheets(personalExpenses, sharedExpenses, sheetId) {
  try {
    const monthColumn = getColumnForCurrentMonth();
    
    // Cancella i dati esistenti nel foglio per le righe specifiche
    const clearRequests = Object.values(categoryToCellMap).map((row) => ({
      range: `${monthColumn}${row}`,
      values: [[]], // Svuota la cella
    }));
    
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      resource: {
        data: clearRequests,
        valueInputOption: "USER_ENTERED",
      },
    });

    const personalTotals = {}; // Mappa per memorizzare i totali delle spese personali
    const sharedTotals = {}; // Mappa per memorizzare i totali delle spese condivise

    // Aggiungi le spese personali (ignora le spese condivise)
    for (const expense of personalExpenses) {
      if (expense.type === "condivisa") {
        continue; // Ignora le spese condivise in personalExpenses
      }
      const row = categoryToCellMap[expense.category];
      if (row) {
        personalTotals[row] = (personalTotals[row] || 0) + expense.price;
      }
    }

    // Aggiungi le spese condivise (prezzo diviso a metà)
    for (const expense of sharedExpenses) {
      const row = categoryToCellMap[expense.category];
      if (row) {
        const dividedPrice = expense.price / 2; // Dividi il prezzo delle spese condivise
        sharedTotals[row] = (sharedTotals[row] || 0) + dividedPrice;
      }
    }

    // Combina i totali delle spese personali e condivise
    const combinedTotals = {};
    for (const [row, total] of Object.entries(personalTotals)) {
      combinedTotals[row] = (combinedTotals[row] || 0) + total; // Aggiungi le spese personali
    }
    for (const [row, total] of Object.entries(sharedTotals)) {
      combinedTotals[row] = (combinedTotals[row] || 0) + total; // Aggiungi le spese condivise
    }

    // Aggiungi i totali calcolati come richieste per il foglio
    const requests = [];
    for (const [row, total] of Object.entries(combinedTotals)) {
      requests.push({
        range: `${monthColumn}${row}`,
        values: [[total]],
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      resource: {
        data: requests,
        valueInputOption: "USER_ENTERED",
      },
    });

    console.log(`Dati sincronizzati sul foglio ${sheetId}`);
  } catch (error) {
    console.error("Errore durante la sincronizzazione dei fogli:", error);
  }
}


// Route per recuperare e sincronizzare le spese
app.get("/api/expenses", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    // Recupera le spese personali per l'utente
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

    // Recupera le spese condivise
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

    // Sincronizza le spese nei fogli
    const userSheetId =
      uid === "sWuGrYb180QskI4agvGKJgVMnzs2" ? SPREADSHEET_ID_YOUR : SPREADSHEET_ID_MIRANDA;

    await syncExpensesToSheets(personalExpenses, sharedExpenses, userSheetId);

    // Rispondi con le spese
    res.json({ personalExpenses, sharedExpenses });
  } catch (error) {
    if (error.code === "auth/id-token-expired") {
      return res.status(401).send("Token scaduto, aggiorna il token");
    }
    console.error("Errore durante il recupero delle spese:", error);
    res.status(500).send("Errore del server");
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

    const newExpense = {
      uid: uid,
      description: description,
      category: category,
      price: price,
      type: type,
      date: new Date(),
    };

    const docRef = await db.collection("expenses").add(newExpense);

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

    res.json({ message: "Spesa aggiornata con successo" });
  } catch (error) {
    console.error("Errore durante l'aggiornamento della spesa:", error);
    res.status(500).send("Errore del server");
  }
});

// Route to delete all expenses
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
