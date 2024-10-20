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
async function addExpenseToSheets(
  description,
  price,
  category,
  shared,
  spreadsheetId
) {
  try {
    let yourPrice = price;
    let mirandaPrice = 0;

    // Se la spesa è condivisa, dividila a metà
    if (shared) {
      yourPrice = price / 2;
      mirandaPrice = price / 2;
    }

    // Log per la suddivisione della spesa
    console.log(
      `Prezzo da inserire: yourPrice=${yourPrice}, mirandaPrice=${mirandaPrice}`
    );

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

    // Log della cella e del foglio in cui stai scrivendo
    console.log(
      "Categoria:",
      category,
      "Cella:",
      cell,
      "Foglio:",
      spreadsheetId
    );

    // Aggiungi la spesa al foglio giusto
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId, // Usa l'ID del foglio passato
      range: `Sheet1!${cell}`, // Aggiungi il valore alla cella corretta
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[yourPrice]], // Inserisci solo il prezzo
      },
    });

    console.log(
      `Spesa di ${yourPrice} aggiunta a ${spreadsheetId} nella cella ${cell}`
    );

    if (shared) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId, // Usa l'ID del foglio passato
        range: `Sheet1!${cell}`, // Per Miranda
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[mirandaPrice]], // Inserisci il prezzo condiviso
        },
      });
      console.log(
        `Prezzo condiviso di ${mirandaPrice} aggiunto nella cella ${cell}`
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
app.post("/api/expenses/add", async (req, res) => {
  const { token, category, price, type, description, shared } = req.body;

  if (!token) {
    console.error("Token is missing");
    return res.status(401).send("Unauthorized: No token provided");
  }

  try {
    // Verifica il token dell'utente
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = decodedToken.email; // Prendi l'email dell'utente

    // Log per verificare il token e l'email
    console.log("Token verificato:", decodedToken);
    console.log("Email dell'utente autenticato:", email);

    // Scegli il foglio corretto in base all'utente
    let spreadsheetId;
    const authorizedUsers = {
      "miri@mail.com": SPREADSHEET_ID_MIRANDA,
      "dani@mail.com": SPREADSHEET_ID_YOUR,
    };
    
    // Verifica se l'email dell'utente è autorizzata
    if (authorizedUsers[email]) {
      spreadsheetId = authorizedUsers[email];
      console.log(`Usando il foglio per ${email}:`, spreadsheetId);
    } else {
      console.log("Utente non autorizzato:", email);
      return res.status(400).send("Utente non autorizzato");
    }

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
      shared,
      spreadsheetId
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
