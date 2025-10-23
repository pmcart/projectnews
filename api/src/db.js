import { MongoClient, ServerApiVersion } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGODB_URI in environment");
  process.exit(1);
}
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 20,
});

let _db;

export async function getDb() {
  if (_db) return _db;
  await client.connect();
  _db = client.db(process.env.DB_NAME || "org1");
  return _db;
}

export async function getCollection(name) {
   const db = await getDb();
  // Allow "dbName.collectionName" to target a different DB (e.g. regional_news.us_all)
  if (typeof name === "string" && name.includes(".")) {
    const [dbName, coll] = name.split(".", 2);
    // reuse the same connected client; just select another DB
    return client.db(dbName).collection(coll);
  }
  return db.collection(name);
}

export async function closeDb() {
  await client.close();
  _db = null;
}
