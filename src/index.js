const express = require("express");
const cors = require("cors");
const admin = require("./firebase"); // Ensure Firebase is initialized correctly
const { google } = require("googleapis"); // Libreria Google API
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

// Autenticazione tramite il service account
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// ID dei fogli Google
const SPREADSHEET_ID_YOUR = "1ub7knShEP9zqfnskxUGQIL3sqmPZ-cV_n6Z9VvKLG-0"; // ID del tuo foglio
const SPREADSHEET_ID_MIRANDA = "1AOjqabjFF4r2lIBtrfDCaYYYEqUcX9HGk8A4GpJKd7E"; // ID del foglio di Miranda

// Funzione per aggiungere spese ai fogli Google
// Funzione per aggiungere spese ai fogli Google
// Funzione per aggiungere spese ai fogli Google
async function addExpenseToSheets(description, price, category, shared, email) {
  try {
    let yourPrice = price;
    let mirandaPrice = 0;

    // Se la spesa è condivisa, dividila a metà
    if (shared) {
      yourPrice = price / 2;
      mirandaPrice = price / 2;
    }

    // Mappatura tra categorie e celle
    const categoryToCellMap = {
      Trasporti: "D1",
      Cibo: "D2",
      // Aggiungi altre categorie e celle qui
    };

    const cell = categoryToCellMap[category];

    if (!cell) {
      throw new Error(`Categoria non riconosciuta: ${category}`);
    }

    // Log per la cella e il foglio per l'utente corrente
    const spreadsheetIdCurrentUser =
      email === "miri@mail.com" ? SPREADSHEET_ID_MIRANDA : SPREADSHEET_ID_YOUR;

    // Leggi il valore esistente nella cella
    const getResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetIdCurrentUser,
      range: `Sheet1!${cell}`,
    });

    // Ottieni il valore esistente, se presente
    let existingValue = getResponse.data.values
      ? getResponse.data.values[0][0]
      : "0";

    // Converti il valore esistente in numero, gestendo eventuali casi non numerici
    existingValue = parseFloat(existingValue) || 0;

    console.log(`Valore esistente nella cella ${cell}: ${existingValue}`); // Log per il valore esistente

    // Somma il nuovo valore al valore esistente
    const newValue = existingValue + yourPrice;

    console.log(`Nuovo valore calcolato: ${newValue}`); // Log per il nuovo valore calcolato

    // Aggiorna la cella con il nuovo valore
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetIdCurrentUser,
      range: `Sheet1!${cell}`,
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[newValue]], // Aggiungi solo il prezzo per l'utente corrente
      },
    });

    console.log(
      `Spesa di ${yourPrice} aggiunta per ${email} nella cella ${cell}. Nuovo valore: ${newValue}`
    );

    // Se la spesa è condivisa, aggiungila anche all'altro utente
    if (shared) {
      const spreadsheetIdOtherUser =
        email === "miri@mail.com"
          ? SPREADSHEET_ID_YOUR
          : SPREADSHEET_ID_MIRANDA;

      // Leggi il valore esistente nella cella per l'altro utente
      const getResponseOther = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetIdOtherUser,
        range: `Sheet1!${cell}`,
      });

      let existingValueOther = getResponseOther.data.values
        ? getResponseOther.data.values[0][0]
        : "0";

      // Converti il valore esistente in numero
      existingValueOther = parseFloat(existingValueOther) || 0;

      console.log(
        `Valore esistente per l'altro utente nella cella ${cell}: ${existingValueOther}`
      ); // Log per il valore esistente dell'altro utente

      // Somma il nuovo valore al valore esistente per l'altro utente
      const newValueOther = existingValueOther + mirandaPrice;

      console.log(
        `Nuovo valore calcolato per l'altro utente: ${newValueOther}`
      ); // Log per il nuovo valore calcolato dell'altro utente

      // Aggiorna la cella con il nuovo valore per l'altro utente
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetIdOtherUser,
        range: `Sheet1!${cell}`,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[newValueOther]], // Aggiungi il prezzo per l'altro utente
        },
      });

      console.log(
        `Prezzo condiviso di ${mirandaPrice} aggiunto all'altro foglio nella cella ${cell}. Nuovo valore: ${newValueOther}`
      );
    }
  } catch (error) {
    console.error("Errore durante l'aggiunta della spesa ai fogli:", error);
  }
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

    // Assuming you have some way to determine shared expenses
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

app.get("/api/expenses", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

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

    res.json(expenses); // Ensure the response is an array
  } catch (error) {
    console.error("Errore durante il recupero delle spese:", error);
    res.status(500).send("Errore del server");
  }
});

// Route to get shared expenses
app.get("/api/expenses", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

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

    res.json(expenses);
  } catch (error) {
    if (error.code === "auth/id-token-expired") {
      return res.status(401).send("Token scaduto, aggiorna il token");
    }
    console.error("Errore durante il recupero delle spese:", error);
    res.status(500).send("Errore del server");
  }
});

// Route to add an expense
// Route to add an expense
// Modifica nel tuo endpoint /api/expenses/add
app.post("/api/expenses/add", async (req, res) => {
  const { category, price, type, description } = req.body;

  // Estrai il token dall'header
  const token = req.body.token; // Questo è il token passato nel body

  if (!token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    // Verifica il token e decodifica le informazioni
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = decodedToken.email; // Assicurati di avere l'email qui

    // Assumi che 'type' determini se è condivisa
    const shared = type === "condivisa"; // Assicurati che il valore sia booleano

    // Log per vedere il valore di shared
    console.log("Valore di shared:", shared);

    // Crea un nuovo documento nella collezione "expenses"
    const newExpense = {
      uid: uid,
      description: description,
      category: category,
      price: price,
      type: type,
      date: new Date(),
    };

    // Log per la nuova spesa
    console.log("Nuova spesa creata:", newExpense);

    // Aggiungi la spesa al database Firestore
    const docRef = await db.collection("expenses").add(newExpense);
    console.log("Spesa salvata nel database con ID:", docRef.id);

    // Aggiungi la spesa ai fogli Google, passando l'ID del foglio giusto
    await addExpenseToSheets(
      description,
      price,
      category,
      shared, // Passa il valore booleano
      email // Includi l'email
    );

    res.json({ message: "Spesa aggiunta con successo", expenseId: docRef.id });
  } catch (error) {
    console.error("Errore durante l'aggiunta della spesa:", error);
    res.status(500).send("Errore del server");
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
