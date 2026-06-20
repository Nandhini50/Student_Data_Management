const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

const USERS_FILE = path.join(__dirname, "users.json");
const STUDENTS_FILE = path.join(__dirname, "students.json");
const MARKS_FILE = path.join(__dirname, "marks.json");
const SESSIONS_FILE = path.join(__dirname, "sessions.json");

// ---------- File helpers ----------

function readJsonFile(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
        return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getUsers() { return readJsonFile(USERS_FILE, []); }
function getStudents() { return readJsonFile(STUDENTS_FILE, []); }
function saveStudents(s) { writeJsonFile(STUDENTS_FILE, s); }
function getMarks() { return readJsonFile(MARKS_FILE, []); }
function saveMarks(m) { writeJsonFile(MARKS_FILE, m); }
function getSessions() { return readJsonFile(SESSIONS_FILE, {}); }
function saveSessions(s) { writeJsonFile(SESSIONS_FILE, s); }

// ---------- Validation helpers ----------

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidMobile(mobile) {
   
    return /^[0-9]{10}$/.test(mobile);
}

// ---------- Marks helpers ----------

function computeMarksSummary(internal, external) {
    const total = Number(internal) + Number(external);
    const average = total / 2;
    return { total, average, grade: computeGrade(average) };
}


function computeGrade(average) {
    if (average >= 45) return "A+";
    if (average >= 40) return "A";
    if (average >= 35) return "B";
    if (average >= 30) return "C";
    if (average >= 25) return "D";
    return "F";
}

function getMarksForStudent(studentId) {
    return getMarks().find((m) => m.studentId === studentId) || null;
}

// ---------- Routes ----------

app.get("/", (req, res) => {
    res.send("Student Management Backend Running");
});


app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !username.trim()) {
        return res.status(400).json({ message: "Username is required." });
    }
    if (!password) {
        return res.status(400).json({ message: "Password is required." });
    }

    const users = getUsers();
    const user = users.find((u) => u.username === username.trim());

    if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid username or password." });
    }

    const sessions = getSessions();
    const token = crypto.randomBytes(16).toString("hex");

    // Overwrite any existing session for this username — single active session
    sessions[user.username] = token;
    saveSessions(sessions);

    res.json({ message: "Login Successful", username: user.username, token });
});

app.post("/logout", (req, res) => {
    const { username } = req.body;
    const sessions = getSessions();
    delete sessions[username];
    saveSessions(sessions);
    res.json({ message: "Logged out" });
});



app.post("/students", (req, res) => {
    const { rollNumber, name, department, email, mobile } = req.body;

    const errors = [];

    if (!rollNumber || !String(rollNumber).trim()) errors.push("Roll Number is required.");
    if (!name || !name.trim()) errors.push("Name is required.");
    if (!department || !department.trim()) errors.push("Department is required.");
    if (!email || !isValidEmail(email)) errors.push("A valid email is required.");
    if (!mobile || !isValidMobile(mobile)) errors.push("Mobile must be exactly 10 digits.");

    if (errors.length > 0) {
        return res.status(400).json({ message: errors.join(" ") });
    }

    const students = getStudents();
    const rollTrimmed = String(rollNumber).trim();
    const duplicateRoll = students.find(
        (s) => String(s.rollNumber).trim().toLowerCase() === rollTrimmed.toLowerCase()
    );
    if (duplicateRoll) {
        return res.status(409).json({ message: "This Roll Number is already registered." });
    }

    const student = {
        id: Date.now().toString(),
        rollNumber: rollTrimmed,
        name: name.trim(),
        department: department.trim(),
        email: email.trim(),
        mobile: String(mobile).trim(),
    };

    students.push(student);
    saveStudents(students);

    res.status(201).json({ message: "Student Registered Successfully", student });
});


app.get("/students", (req, res) => {
    let students = getStudents();

    const seen = new Set();
    students = students.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
    });

    const { search, sortBy, order } = req.query;

    if (search) {
        const term = search.trim().toLowerCase(); 
        students = students.filter(
            (s) =>
                s.name.toLowerCase().includes(term) ||
                s.rollNumber.toLowerCase().includes(term) ||
                s.department.toLowerCase().includes(term) ||
                s.email.toLowerCase().includes(term)
        );
    }

    if (sortBy) {
        const dir = order === "desc" ? -1 : 1;
        students = [...students].sort((a, b) => {
            const valA = String(a[sortBy] ?? "").toLowerCase();
            const valB = String(b[sortBy] ?? "").toLowerCase();
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });
    }

    const withMarks = students.map((s) => {
        const marks = getMarksForStudent(s.id);
        return {
            ...s,
            marks: marks
                ? {
                      internal: marks.internal,
                      external: marks.external,
                      total: marks.internal + marks.external,
                      average: (marks.internal + marks.external) / 2,
                      grade: computeGrade((marks.internal + marks.external) / 2),
                  }
                : null,
        };
    });

    res.json(withMarks);
});

app.get("/students/:id", (req, res) => {
    const student = getStudents().find((s) => s.id === req.params.id);
    if (!student) return res.status(404).json({ message: "Student not found." });
    res.json(student);
});


app.put("/students/:id", (req, res) => {
    const { id } = req.params;
    const { rollNumber, name, department, email, mobile } = req.body;

    const students = getStudents();
    const index = students.findIndex((s) => s.id === id);

    if (index === -1) {
        return res.status(404).json({ message: "Student not found." });
    }

    const errors = [];
    if (!name || !name.trim()) errors.push("Name is required.");
    if (!department || !department.trim()) errors.push("Department is required.");
    if (!email || !isValidEmail(email)) errors.push("A valid email is required.");
    if (!mobile || !isValidMobile(mobile)) errors.push("Mobile must be exactly 10 digits.");

    if (rollNumber && String(rollNumber).trim()) {
        const rollTrimmed = String(rollNumber).trim();
        const duplicateRoll = students.find(
            (s) =>
                s.id !== id &&
                String(s.rollNumber).trim().toLowerCase() === rollTrimmed.toLowerCase()
        );
        if (duplicateRoll) errors.push("This Roll Number is already used by another student.");
    }

    if (errors.length > 0) {
        return res.status(400).json({ message: errors.join(" ") });
    }

    students[index] = {
        ...students[index],
        rollNumber: rollNumber ? String(rollNumber).trim() : students[index].rollNumber,
        name: name.trim(),
        department: department.trim(),
        email: email.trim(),
        mobile: String(mobile).trim(),
    };

    saveStudents(students);

    res.json({ message: "Student updated successfully.", student: students[index] });
});


app.delete("/students/:id", (req, res) => {
    const { id } = req.params;
    const { confirm } = req.body || {};

    if (confirm !== true) {
        return res.status(400).json({ message: "Deletion must be confirmed (confirm: true required)." });
    }

    const students = getStudents();
    const exists = students.some((s) => s.id === id);
    if (!exists) {
        return res.status(404).json({ message: "Student not found." });
    }

    const remaining = students.filter((s) => s.id !== id);
    saveStudents(remaining);

    const marks = getMarks().filter((m) => m.studentId !== id);
    saveMarks(marks);

    res.json({ message: "Student deleted successfully." });
});

// ===== MARKS MODULE =====
app.post("/marks", (req, res) => {
    const { studentId, internal, external } = req.body;

    if (!studentId) {
        return res.status(400).json({ message: "studentId is required." });
    }

    const internalNum = Number(internal);
    const externalNum = Number(external);

    if (
        internal === undefined || internal === null || isNaN(internalNum) ||
        external === undefined || external === null || isNaN(externalNum) ||
        internalNum < 0 || internalNum > 50 ||
        externalNum < 0 || externalNum > 50
    ) {
        return res.status(400).json({ message: "Internal and External marks must be numbers between 0 and 50." });
    }

    const students = getStudents();
    if (!students.some((s) => s.id === studentId)) {
        return res.status(404).json({ message: "Student not found." });
    }

    const marks = getMarks();
    const existingIndex = marks.findIndex((m) => m.studentId === studentId);
    const record = { studentId, internal: internalNum, external: externalNum };

    if (existingIndex !== -1) {
        marks[existingIndex] = record;
    } else {
        marks.push(record);
    }
    saveMarks(marks);

    const summary = computeMarksSummary(internalNum, externalNum);
    res.json({ message: "Marks saved.", ...summary });
});

app.get("/marks/:studentId", (req, res) => {
    const record = getMarksForStudent(req.params.studentId);
    if (!record) return res.status(404).json({ message: "No marks recorded for this student." });
    const summary = computeMarksSummary(record.internal, record.external);
    res.json({ studentId: record.studentId, internal: record.internal, external: record.external, ...summary });
});

app.get("/dashboard", (req, res) => {
    let students = getStudents();

    // De-duplicate defensively (mirrors the /students fix for Bug #10)
    const seen = new Set();
    students = students.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
    });

    const totalStudents = students.length;

    const departmentCounts = {};
    students.forEach((s) => {
        const key = (s.department || "Unassigned").trim();
        departmentCounts[key] = (departmentCounts[key] || 0) + 1;
    });

    const marks = getMarks();
    const studentsWithMarks = students.filter((s) =>
        marks.some((m) => m.studentId === s.id)
    );
    const classAverage =
        studentsWithMarks.length === 0
            ? null
            : Math.round(
                  (studentsWithMarks.reduce((sum, s) => {
                      const m = getMarksForStudent(s.id);
                      return sum + (m.internal + m.external) / 2;
                  }, 0) /
                      studentsWithMarks.length) *
                      10
              ) / 10;

    res.json({
        totalStudents,
        departmentCounts,
        totalMarksEntries: marks.length,
        classAverage,
    });
});

app.listen(5000, () => {
    console.log("Server running at http://localhost:5000");
});
