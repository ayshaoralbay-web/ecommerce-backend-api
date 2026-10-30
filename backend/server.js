import http from "node:http";
import { readFile } from "node:fs/promises";
import pg from "pg";


const PORT = 5001;


const pool = new pg.Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: process.env.DB_PASSWORD || "0000",
  database: "myapp",
});


async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      artist VARCHAR(255) NOT NULL,
      genre VARCHAR(50),
      year INT,
      duration VARCHAR(10),
      image TEXT
    );
  `);
  await pool.query(
    "UPDATE tracks SET image = $1 WHERE LOWER(title) = $2",
    [
      "https://i.pinimg.com/736x/ed/47/a0/ed47a050599dfa9fb4a3371e5343ec00.jpg",
      "greedy",
    ]
  );
  console.log("ready");
}

  
  

function sendJSON(res, status, data) {
  res.writeHead(status);
  if (data) {
    res.end(JSON.stringify(data));
  } else {
    res.end(); 
  }
}


function getBody(req) {
  return new Promise((resolve) => {
    let body = "";
    
    
    req.on("data", (chunk) => body += chunk);
    
    
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}


async function getTracks(searchParams, res) {
  
  const q = searchParams.get("q") || "";
  const genre = searchParams.get("genre") || "";
   
  let page = Number(searchParams.get("page")) || 1;
  let limit = Number(searchParams.get("limit")) || 6;

  
  const allowedSort = ["id", "title", "artist", "genre", "year"];


let sort = searchParams.get("sort") || "id";

if (!allowedSort.includes(sort)) {
  sort = "id";
}
  let order = "ASC";
  if (searchParams.get("order") === "desc") {
    order = "DESC";
  }

  
  const where = [];
  const values = [];

  if (q !== "") {
    values.push("%" + q + "%");
    where.push("(title ILIKE $" + values.length + " OR artist ILIKE $" + values.length + ")");
  }

  if (genre !== "" && genre !== "all") {
    values.push(genre);
    where.push("genre ILIKE $" + values.length);
  }

  let whereSQL = "";
  if (where.length > 0) {
    whereSQL = "WHERE " + where.join(" AND ");
  }

  
  const countRes = await pool.query("SELECT COUNT(*) FROM tracks " + whereSQL, values);
  const total = Number(countRes.rows[0].count);
  const totalPages = Math.ceil(total / limit) || 1;

  
  const offset = (page - 1) * limit;
  const sql = "SELECT * FROM tracks " + whereSQL + " ORDER BY " + sort + " " + order + " LIMIT $" + (values.length + 1) + " OFFSET $" + (values.length + 2);

  const dataRes = await pool.query(sql, [...values, limit, offset]);

  
  sendJSON(res, 200, {
    data: dataRes.rows,
    meta: {
      page: page,
      limit: limit,
      total: total,
      totalPages: totalPages
    }
  });
} 


async function addTrack(req, res) {
  const body = await getBody(req);

  if (!body.title || !body.artist) {
    return sendJSON(res, 400, { error: "Title and artist are required" });
  }

  const result = await pool.query(
    `INSERT INTO tracks (title, artist, genre, year, duration, image)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      body.title,
      body.artist,
      body.genre || "pop",
      body.year || 2024,
      body.duration || "3:00",
      body.image || "https://picsum.photos/300",
    ]
  );

  sendJSON(res, 201, { data: result.rows[0] });
}


async function deleteTrack(pathname, res) {
  const parts = pathname.split("/"); 
  const id = parseInt(parts[2], 10);

  if (isNaN(id)) {
    return sendJSON(res, 400, { error: "Invalid track ID" });
  }

  const result = await pool.query("DELETE FROM tracks WHERE id = $1", [id]);

  if (result.rowCount === 0) {
    return sendJSON(res, 404, { error: "Track not found" });
  }

  sendJSON(res, 204); 
}


const server = http.createServer(async (req, res) => {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return sendJSON(res, 204);
  }

  const myUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = myUrl.pathname;
  const searchParams = myUrl.searchParams;

  try {
    
    if (req.method === "GET" && pathname === "/") {
      const html = await readFile(new URL("../frontend/index.html", import.meta.url));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    
    if (pathname === "/tracks") {
      if (req.method === "GET") {
        return await getTracks(searchParams, res);
      }
      if (req.method === "POST") {
        return await addTrack(req, res);
      }
    }

   
    if (req.method === "DELETE" && pathname.startsWith("/tracks/")) {
      return await deleteTrack(pathname, res);
    }

    
    sendJSON(res, 404, { error: "Endpoint Not Found" });
  } catch (error) {
    console.error("Server Error:", error);
    sendJSON(res, 500, { error: "Server error" });
  }
});


initDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database connection error:", err);
  });
