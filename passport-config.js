const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const con = require("./connection");

function initialize(passport) {
    const authenticateUser = async (email, password, done) => {
        const sql = "SELECT * FROM patients WHERE email = ?";
        con.query(sql, [email], async (error, results) => {
            if (error) {
                return done(error);
            }
            if (results.length === 0) {
                return done(null, false, { message: 'No user found with that email' });
            }
            const user = results[0];
            try {
                if (await bcrypt.compare(password, user.password)) {
                    return done(null, user);
                } else {
                    return done(null, false, { message: 'Password incorrect' });
                }
            } catch (error) {
                return done(error);
            }
        });
    };

    passport.use(new LocalStrategy({ usernameField: 'email' }, authenticateUser));

    passport.serializeUser((user, done) => {
        done(null, user.email);
    });

    passport.deserializeUser((email, done) => {
        const cmnd = "Select * from patients where email=?";
        con.query(cmnd, [email], (error, results) => {
            if (error) {
                return done(error);
            }
            return done(null, results[0]);
        });
    });
}

module.exports = initialize;
