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
const fs = require("fs");

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

app.post('/deletePrescription', checkAuthenticated, (req, res) => {
    const userId = req.user.id;
    const filename = req.body.filename;
    const filepath = path.join(__dirname, 'uploads', filename);

    // Delete file from the filesystem
    fs.unlink(filepath, (err) => {
        if (err) {
            console.error('Error deleting file:', err);
            req.flash('error', 'Error deleting file');
            return res.redirect('/uploadprescription');
        }

        // Delete file record from the database
        const sql = 'DELETE FROM prescriptions WHERE id = ? AND filename = ?';
        con.query(sql, [userId, filename], (error, result) => {
            if (error) {
                console.error('Error deleting prescription from database:', error);
                req.flash('error', 'Error deleting prescription from database');
                return res.redirect('/uploadprescription');
            }

            req.flash('success', 'Prescription deleted successfully');
            res.redirect('/uploadprescription');
        });
    });
});

app.post("/delete-document", (req, res) => {
    const { pres_name } = req.body;
    // Delete the specific document based on id and uploaded_at
    con.query("DELETE FROM documents WHERE pres_name = ?", [pres_name], (err, result) => {
        if (err) {
            console.error("Error deleting document:", err);
            req.flash('error', 'Error deleting document');
            return res.redirect("/details");
        }

        req.flash('success', 'Document deleted successfully');
        res.redirect("/details");
    });
});


//   function saveDocumentsToDB(userId, prescriptionFilename, prescriptionPath, pharmacySlipFilename, pharmacySlipPath, callback) {
//     const sql = "INSERT INTO documents (id, pres_name, pres_path, pharmacy_slip_name, pharmacy_slip_path, vis_status) VALUES (?, ?, ?, ?, ?, 'pending')";
//     con.query(sql, [userId, prescriptionFilename, prescriptionPath, pharmacySlipFilename, pharmacySlipPath], (error, result) => {
//         if (error) {
//             console.error("Error saving documents to database:", error);
//             return callback(error);
//         }
//         console.log("Documents saved to database");
//         callback(null, result.insertId); // Pass the inserted ID to the callback function
//     });
// }

app.post("/api/uploadPrescriptionAndBilling", checkAuthenticated, (req, res) => {
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
        const { id, name, email, phone, message } = req.body;
        const prescriptionFile = req.files['prescriptionFile'] ? req.files['prescriptionFile'][0] : null;
        const billingFile = req.files['billingFile'] ? req.files['billingFile'][0] : null;

        if (!prescriptionFile || !billingFile) {
            req.flash('error', 'Please upload both files.');
            return res.redirect('/bill');
        }

        const presName = prescriptionFile.filename;
        const presPath = prescriptionFile.path;
        const pharmacySlipName = billingFile.filename;
        const pharmacySlipPath = billingFile.path;
        const sql = 'INSERT INTO documents (id, pres_name, pres_path, pharmacy_slip_name, pharmacy_slip_path, vis_status, name, phone_number,email, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        const values = [id, presName, presPath, pharmacySlipName, pharmacySlipPath, 'Pending', name, phone, email, message];

        con.query(sql, values, (err, result) => {
            if (err) {
                console.error('Error inserting into database:', err);
                req.flash('error', 'Database error. Please try again later.');
                return res.redirect('/bill');
            }
            anotherNotification(req.body.id, req.body.name, `ID ${req.body.id} has uploaded files for requesting medical billing.`);
            req.flash('success', 'Documents uploaded successfully!');
            res.redirect('/bill');
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
    const { patientId } = req.body;

    // Retrieve documents based on patientId from the documents table
    con.query("SELECT * FROM documents WHERE id = ?", [patientId], (err, documents) => {
        if (err) {
            console.error("Error retrieving documents:", err);
            req.flash('error', 'Error retrieving documents');
            return res.redirect("/details");
        }

        if (documents.length === 0) {
            // No documents found for this patient
            req.flash('error', 'No patient found with the provided ID');
            return res.redirect("/details");
        }

        // Render the details page with patient and documents information
        res.render("details", { patient: documents[0], documents: documents, error: req.flash("error") });
    });
});

function anotherNotification(id, name, message) {
    const sql = "INSERT INTO adminnotify (id, name, message) VALUES (?, ?,?)";
    con.query(sql, [id, name, message], (error, result) => {
        if (error) {
            console.error("Error creating notification:", error);
        }
    });
}

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
    const namesql = "select name from patients where id=?";
    con.query(namesql,[appointmentId],(error, results) => {
        if (error) {
            console.error("Error fetching patient name:", error);
            return res.status(500).send("Internal Server Error");
        }
        if (results.length === 0) {
            return res.status(404).send("Patient not found");
        }
        
        const patientName = results[0].name;

    const doctorsql = "select doctor from appointment where unique_id=?";
    con.query(doctorsql,[uid],(error, results) => {
        if (error) {
            console.error("Error fetching Data:", error);
            return res.status(500).send("Internal Server Error");
        }
        if (results.length === 0) {
            return res.status(404).send("Data not found");
        }
        
        const Doctor = results[0].doctor
        console.log(Doctor);

    const sql = "UPDATE appointment SET status = 'approved' WHERE unique_id = ?";
    con.query(sql, [uid], (error, result) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        let timeSlot;
            if (Doctor === "Dr. Fakharuddin Ahmed") {
                timeSlot = "10.00 AM to 12.00 PM.";
            } else if(Doctor === "Dr. Salma Khatun") {
                timeSlot = "2.30PM to 4.00 PM.";
            }else
            {
                timeSlot = "4.00PM to 6.00 PM.";
            }
        // Create a notification for approval
        createNotification(appointmentId,uid, `Dear ${patientName}, your appointment has been approved by ${Doctor}.Please confirm your presence between ${timeSlot}`);
        res.redirect("/appointmentlist");
    });
});
});
});

app.post("/reject-appointment", (req, res) => {
    const uid = req.body.unique_id;
    const appointmentId = req.body.id;
    const rejectMessage = req.body.rejection_message;
    const namesql = "select name from patients where id="+""+appointmentId+""+" ";
    con.query(namesql,(error, results) => {
        if (error) {
            console.error("Error fetching patient name:", error);
            return res.status(500).send("Internal Server Error");
        }
        if (results.length === 0) {
            return res.status(404).send("Patient not found");
        }
        
        const patientName = results[0].name;
    const sql = "UPDATE appointment SET status = 'rejected' WHERE unique_id = ?";
    con.query(sql, [uid], (error, result) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        // Create a notification for rejection
        createNotification(appointmentId,uid,`Dear ${patientName}, We regret to inform that your appointment has been rejected Because ${rejectMessage}`);
        res.redirect("/appointmentlist");
    });
});
});

app.post("/cancel-appointment", checkAuthenticated, (req, res) => {
    const uid = req.body.unique_id;
    const userId = req.user.id;

    const sql = "UPDATE appointment SET status = 'cancelled' WHERE unique_id = ? AND id = ?";
    con.query(sql, [uid, userId], (error, result) => {
        if (error) {
            console.error("Error cancelling appointment:", error);
            return res.status(500).send("Internal Server Error");
        }
        req.flash("success", "Appointment cancelled successfully");
        res.redirect("/myappointments");
    });
});

app.get('/myappointments', checkAuthenticated, (req, res) => {
    const userId = req.user.id;
    const sql = "SELECT doctor, appointment_date, status, unique_id FROM appointment WHERE id = ?";
    con.query(sql, [userId], (error, results) => {
        if (error) {
            console.error("Error fetching appointments:", error);
            return res.status(500).send("Internal Server Error");
        }
        res.render("appointmentcancel.ejs", { appointments: results });
    });
});



// Routes
app.get('/user', checkNotAuthenticated, (req, res) => {
    res.render("FPage.ejs");
});

app.get('/searchappointments', (req, res) => {
    const { doctor,appointment_date } = req.query;
    const st = 'approved';
    const sql = "SELECT id, doctor, phone_number, message FROM appointment WHERE doctor = ? AND status = ? AND appointment_date = ?";
    con.query(sql, [doctor, st,appointment_date], (error, results) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        res.render("searchappointment.ejs", { appointments: results, search: true, doctor: doctor,appointment_date:appointment_date });
    });
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

app.get('/bill', checkAuthenticated, (req, res) => {
    res.render("bill_page.ejs", {
        name: req.user.name,
        id: req.user.id,
        email: req.user.email,
        error: req.flash('error'),
        success: req.flash('success'),

    });

});

app.get("/notify", (req, res) => {
    const mmsql = "SELECT * FROM adminnotify";
    con.query(mmsql, (error, results) => {
        if (error) {
            console.error(error);
            return res.status(500).send("Internal Server Error");
        }
        res.render("notify.ejs", { notifies: results });
    });
});


app.get("/details", (req, res) => {
    res.render("details", { error: req.flash("error"), patient: null, documents: null });
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