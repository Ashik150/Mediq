if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}

const express = require("express");
const app = express();
const bcrypt = require("bcrypt"); 
const path = require("path");
const multer = require("multer");
const passport = require("passport");
const initializePassport = require("./passport-config");
const flash = require("express-flash");
const session = require("express-session");
const methodOverride = require("method-override");
const con = require("./connection");
const { v4: uuidv4 } = require('uuid');
const { error } = require("console");

initializePassport(passport);

app.set("view engine", "ejs");

app.use(express.urlencoded({extended: false}));
app.use(flash());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize()); 
app.use(passport.session());
app.use(methodOverride("_method"));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/"); // Destination directory for uploaded files
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
        cb(null, uniqueSuffix);
    },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 100 },
    fileFilter: (req, file, cb) => {
        cb(null, true);
    }
}).single('prescriptionFile');


  function savePrescriptionToDB(nid,filename, filepath, callback) {
    const sql = "INSERT INTO prescriptions (id,filename, filepath, uploaded_at) VALUES (?,?, ?, NOW())";
    con.query(sql, [nid,filename, filepath], (error, result) => {
      if (error) {
        console.error("Error saving prescription to database:", error);
        return callback(error);
      }
      console.log("Prescription saved to database");
      callback(null, result.insertId); // Pass the inserted ID to the callback function
    });
  }

// Function to create notification
function createNotification(appointmentId,uid, message) {
    const sql = "INSERT INTO notifications (appointment_id, message,uid) VALUES (?, ?,?)";
    con.query(sql, [appointmentId, message,uid], (error, result) => {
        if (error) {
            console.error("Error creating notification:", error);
        }
    });
}

app.post("/api/uploadprescription",checkAuthenticated,(req, res) => {
    upload(req, res, function (err) {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                req.flash('error', 'File size cannot exceed 100KB');
            } else {
                req.flash('error', err.message);
            }
            return res.redirect("/uploadprescription");
        }

        if (!req.file) {
            req.flash('error', 'Please upload a file');
            return res.redirect("/uploadprescription");
        }
    // Get the uploaded file details
    const id = req.user.id;
    const filename = req.file.filename;
    const filepath = req.file.path;
  
    // Save prescription data to database
    savePrescriptionToDB(id,filename, filepath, (err, prescriptionId) => {
      if (err) {
        return res.status(500).send("Error uploading prescription");
      }
      req.flash("success","Your prescription has been uploaded successfully!");
      res.redirect("/uploadprescription"); // Redirect to home page or any other page after successful upload
    });
  });
});


  function saveDocumentsToDB(userId, prescriptionFilename, prescriptionPath, pharmacySlipFilename, pharmacySlipPath, callback) {
    const sql = "INSERT INTO documents (id, pres_name, pres_path, pharmacy_slip_name, pharmacy_slip_path, vis_status) VALUES (?, ?, ?, ?, ?, 'pending')";
    con.query(sql, [userId, prescriptionFilename, prescriptionPath, pharmacySlipFilename, pharmacySlipPath], (error, result) => {
        if (error) {
            console.error("Error saving documents to database:", error);
            return callback(error);
        }
        console.log("Documents saved to database");
        callback(null, result.insertId); // Pass the inserted ID to the callback function
    });
}

app.post("/api/uploadPrescriptionAndBilling",checkAuthenticated, (req, res) => {
    const uploadMultiple = multer({
        storage: storage,
        limits: { fileSize: 1024 * 100 }, // 100KB file size limit
    }).fields([{ name: 'prescriptionFile', maxCount: 1 }, { name: 'billingFile', maxCount: 1 }]);
    uploadMultiple(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                req.flash('error', 'File size cannot exceed 100KB');
            } else {
                req.flash('error', 'File upload error');
            }
            return res.redirect("/bill");
        } else if (err) {
            req.flash('error', 'Unknown error occurred');
            return res.redirect("/bill");
        }

        if (!req.files || !req.files['prescriptionFile'] || !req.files['billingFile']) {
            req.flash('error', 'Please upload both files');
            return res.redirect("/bill");
        }

    // Get the uploaded file details
    const userId = req.user.id;
    const prescriptionFile = req.files['prescriptionFile'][0];
    const billingFile = req.files['billingFile'][0];

    // Save prescription and billing files to the 'documents' table
    saveDocumentsToDB(userId, prescriptionFile.originalname, prescriptionFile.path, billingFile.originalname, billingFile.path, (err, documentId) => {
        if (err) {
            console.error("Error uploading documents:", err);
            return res.status(500).send("Error uploading documents");
        }
        req.flash("success","Your documents have been submitted successfully!");
        res.redirect("/bill"); // Redirect after successful upload
    });
});
});


app.post("/patientlogin", checkNotAuthenticated, passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/patientlogin",
    failureFlash: true
}));

app.post("/patientreg", checkNotAuthenticated, async (req, res) => {

    password = req.body.password;

    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 characters long');
        return res.redirect("/patientreg");
    }


    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const name = req.body.name;
        const email = req.body.email;
        const id = req.body.id;
        const sql = "Insert into patients(name,email,password,id) values(?,?,?,?);"
        con.query(sql,[name,email,hashedPassword,id],(error,result)=>{
            if(error){
            req.flash('error', 'Student ID already exists');
            return res.redirect("/patientlogin");
        }
        res.redirect("/patientlogin");
        });
    } catch (e) {
        console.log(e);
        res.redirect("/patientreg");
    }
});

app.post("/adminlogin", (req, res) => {
    const { email, password } = req.body;
    // Simulated logic to check credentials from database
    const sql = "SELECT * FROM admin WHERE email = ? AND password = ? LIMIT 1";
    con.query(sql, [email, password], (error, results) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        if (results.length === 0) {
            req.flash("error", "Invalid email or password");
            return res.redirect("/adminlogin");
        }
        req.session.user = results[0];
        res.redirect("/adminhome");
    });
});

app.post("/adminreg", async (req, res) => {

    const password = req.body.password; 
    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 characters long');
        return res.redirect("/adminreg");
    }
    try {
        const { name, email, password } = req.body;
        const sql = "INSERT INTO admin (name, email, password) VALUES (?, ?, ?);";
        con.query(sql, [name, email, password], (error, result) => {
            if (error) {
              req.flash('error', 'Email already Exists');
              return res.redirect("/adminreg");
            }
            res.redirect("/adminlogin");
        });
    } catch (e) {
        console.error(e);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/details", (req, res) => {
    const id = req.body.patientId;
    const sql = "Select p.name,p.email,q.pres_path from patients p left join documents q on p.id=q.id where p.id=?";

    con.query(sql, [id], (error, results) => {
        if (error) {
            console.error(error);
            res.status(500).send('Internal Server Error');
        } else {
            if (results.length > 0) {
                const patient = results[0]; 
                res.render("details", { patient, error: null });
            } else {
                res.render("details", { patient: null, error: 'Patient not found' });
            }
        }
    });
});

app.post("/appointment", async (req, res) => {
    try {
        const uid = uuidv4();
        const { name, email, date, doctor, id, phone, message } = req.body;
        const sql = "INSERT INTO appointment (name, email,doctor,appointment_date,id, phone_number, message,unique_id) VALUES (?, ?, ?, ?, ?, ?, ?,?);";
        con.query(sql, [name, email, doctor,date, id, phone, message,uid], (error, result) => {
            if (error) {
                console.error(error);
                return res.status(500).send("Internal Server Error");
            }
             // Create notification for the appointment
            createNotification(req.body.id,uid,"Your Appointment request has been sent Successfully");
            req.flash("success","Your Appointment request has been sent Successfully");
            res.redirect("/");
        });
    } catch (e) {
        console.error(e);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/approve-appointment", (req, res) => {
    const uid = req.body.unique_id;
    const appointmentId = req.body.id;
    const sql = "UPDATE appointment SET status = 'approved' WHERE unique_id = ?";
    con.query(sql, [uid], (error, result) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        // Create a notification for approval
        createNotification(appointmentId,uid, "Your appointment has been approved.");
        res.redirect("/appointmentlist");
    });
});

app.post("/reject-appointment", (req, res) => {
    const uid = req.body.unique_id;
    const appointmentId = req.body.id;
    const sql = "UPDATE appointment SET status = 'rejected' WHERE unique_id = ?";
    con.query(sql, [uid], (error, result) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        // Create a notification for rejection
        createNotification(appointmentId,uid,"Your appointment has been rejected.");
        res.redirect("/appointmentlist");
    });
});



// Routes
app.get('/user', checkNotAuthenticated, (req, res) => {
    res.render("FPage.ejs");
});



app.get('/', checkAuthenticated, (req, res) => {
    res.render("index.ejs", {name: req.user.name,email:req.user.email,id:req.user.id,success:req.flash("success")});
});

app.get('/adminhome',(req, res) => {
    if (!req.session.user) {
        return res.redirect("/adminlogin");
    }
    res.render("adminhome.ejs", { name: req.session.user.name });
});

app.get('/patientlogin', checkNotAuthenticated, (req, res) => {
    res.render("patientlogin.ejs");
});

app.get('/patientreg', checkNotAuthenticated, (req, res) => {
    res.render("patientreg.ejs");
});

app.get('/adminlogin', checkNotAuthenticated, (req, res) => {
    res.render("adminlogin.ejs");
});

app.get('/adminreg', checkNotAuthenticated, (req, res) => {
    res.render("adminreg.ejs");
});

app.get("/adminlogout", (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error("Error logging out:", err);
            return next(err);
        }
        res.redirect("/adminlogin");
    });
});

app.get("/logout", (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error("Error logging out:", err);
            return next(err);
        }
        res.redirect("/patientlogin");
    });
});

app.get("/notifications", (req, res) => {
    const userId = req.user.id;
    const sql = "SELECT * FROM notifications where appointment_id=?";
    con.query(sql,[userId],(error, results) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        res.render("notification.ejs", { notifications: results });
    });
});

app.get("/appointmentlist", (req, res) => {
    const st = 'pending';
    const sql = "SELECT id, doctor, appointment_date,unique_id FROM appointment where status=?";
    con.query(sql,[st] ,(error, results) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        res.render("appointmentlist.ejs", { appointments: results });
    });
});

app.get('/bill', (req, res) => {
    res.render("bill_page.ejs", { success: req.flash('success'),error: req.flash('error') });
});

app.get("/details", (req, res) => {
    res.render("details", { patient: null, error: null });
});

app.get('/uploadprescription', checkAuthenticated, (req, res) => {
    const userId = req.user.id; // Assuming you have user authentication implemented
    const sql = "SELECT filename, uploaded_at FROM prescriptions WHERE id = ?";
    con.query(sql, [userId], (error, results) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        res.render("prescriptionPage.ejs", { prescriptions: results, success: req.flash('success'), error: req.flash('error') });
    });
});


// End Routes

function checkAuthenticated(req, res, next){
    if(req.isAuthenticated()){
        return next();
    }
    res.redirect("/patientlogin");
};

function checkNotAuthenticated(req, res, next){
    if(req.isAuthenticated()){
        return res.redirect("/");
    }
    next();
};

app.listen(1511); 