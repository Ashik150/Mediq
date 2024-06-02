const mysql = require("mysql");
const con=  mysql.createConnection({
    host:"localhost",
    user:"root",
    password:"",    
    port:"3308",
    database:"newmediq",
    charset:"utf8mb4"
});

module.exports=con;