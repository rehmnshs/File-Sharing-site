import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import multer from "multer";
const upload = multer({ dest: 'uploads' });
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { google } from "googleapis";
import fs from "fs";
import apikeys from "./apikeys.json" assert { type: "json" };
import { fileTypeFromFile } from "file-type";
import { Readable } from "stream";
import CryptoJS from "crypto-js";
import { v4 as uuidv4 } from 'uuid';
import axios from "axios";
dotenv.config();
const app = express();

app.use(express.json());
app.use(cors());
mongoose.connect(process.env.SERVER_FMID_KEY, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const SCOPE = ["https://www.googleapis.com/auth/drive"];
async function authorize() {
  const jwtClient = new google.auth.JWT(
    apikeys.client_email,
    null,
    apikeys.private_key,
    SCOPE
  );
  await jwtClient.authorize();
  return jwtClient;
}
const authClient = await authorize();

const uploadFile = async (file) => {
  try {
    if (!fs.existsSync(file.path)) {
      throw new Error(`File not found: ${file.path}`);
    }

    const drive = google.drive({ version: "v3", auth: authClient });

    const fileMetaData = {
      name: file.originalname,
    };

    const fileStream = fs.createReadStream(file.path);

    const response = await drive.files.create({
      resource: fileMetaData,
      media: {
        body: fileStream,
        mimeType: file.mimetype,
      },
      fields: "id",
    });

    const fileId = response.data.id;
    console.log(response);
    console.log(`${fileId} has been successfully created on Google Drive`);

    if (fileId) {
      fs.unlinkSync(file.path);
    }

    return fileId.toString();

  } catch (error) {
    console.error('Error uploading file:', error.message);
    if (error.response && error.response.data) {
      console.error('Error details:', error.response.data);
    }
    throw error;
  }
};


/*
async function uploadFile(authClient,file){

  return new Promise((resolve,rejected)=>{

      const drive = google.drive({version:'v3',auth:authClient});
      var fileMetaData = {
          name:`${file.originalname}`,    
          parents:['-0'] 
      }
      const fileStream = Readable.from([file.buffer]);
      drive.files.create({
          resource:fileMetaData,
          media:{
              body: fileStream, // files that will get uploaded
              mimeType: file.mimeType
          },
          fields:'id'
      },function(error,fil){
          if(error){
              return rejected(error)
          }
          console.log(`${fil.data.id} is Succesfully been created on google drive`);
          return resolve((fil)=>fil.data.id );

          //downloadFile(authClient)
      })

  });
  
}*/

async function downloadFile(id) {


  const service = google.drive({ version: "v3", auth: authClient });

  try {
    await service.permissions.create({
      fileId: id,
      requestBody: { role: "reader", type: "anyone" },
    });
    const file = await service.files.get({
      fileId: id,
      fields: "webContentLink",
    });
    return file;
  } catch (err) {
    console.log(err)
    throw err;
  }
}

const File = new mongoose.Schema({
  originalname: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
  fileid:{
    type:String,
    required: true,
  },
  googledriveid: {
    type: String,
    required: true,
  },
  downloadCount: {
    type: Number,
    required: true,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const file = mongoose.model("Files", File);

const deleteFILE = async (id) => {
  const drive = google.drive({ version: "v3", auth: authClient });

  const response = await drive.files
    .delete({
      fileId: id,
    })
    .then(async (res) => {
      
      const deletedDocument = await file.deleteOne({ googledriveid: id });
      
      console.log(deletedDocument);
      return deletedDocument
    });
    return response
};
const db = mongoose.connection;
db.on("error", (error) => {
  console.error("Error connecting to the database:", error);
});

db.once("open", () => {
  console.log("Connected to the DB");
});
app.get("/", async (req, res) => {
  res.send("?");
});

app.post("/putFile", upload.single("selectedFile"), async (req, res) => {
  try {

    const originalname = req.file.originalname;
    console.log(originalname)
    const fileid = uuidv4().slice(0,5);
    const k = await uploadFile(req.file);
    if (typeof(k) == "string") {
      const f = await file.create({
        originalname: originalname,
        password: req.body.password,
        fileid:fileid,
        googledriveid: k,
        downloadCount: 0,
      });
      
      console.log(`sent to mongo ${originalname}`);
      const id = f.id;
      res.status(201).json({
        message: "it been saved to server and to google drive",
        id: fileid,
      });
    } else {
      console.log("error or something");
      res.status(501).json("error occured on /putFile");
    }
  } catch (error) {
    console.log("Error: ", error);
  }
  /*
const authResult = await authorize();
const res1 = await downloadFile(authResult,req.file); 
await deleteFILE(authResult)

const buffer = res1[Object.getOwnPropertySymbols(res1)[1]];

fs.writeFileSync(`./${req.file.originalname}`, buffer );
const blob = new Blob([buffer], { type: 'application/octet-stream' });

// Send temporary URL to frontend
res.json({ url:blo });*/
});
app.post("/getFile", async (req, res) => {
  const id = req.body.id;
  const foundDocument = await file.findOne({ fileid: id }).then((file) => {
    return file;
});
  /*
  const foundDocument = await file.findById(id).then(
    (file) => {return file},
    () => {res.status(404).json({ message: "Invalid ID" }); return null; })
  */
 if (!foundDocument){
  res.status(404).json({ message: "Invalid ID" });
  
 }
  if (foundDocument) {
    const password = req.body.password;

    foundDocument.downloadCount += 1;
    foundDocument.save();
    const pass2decrybytes = CryptoJS.AES.decrypt(
      foundDocument.password,
      `${process.env.SERVER_ENCRYPT_KEY}`
    );
    var storedpassword = pass2decrybytes.toString(CryptoJS.enc.Utf8);
    if (password === storedpassword) {
      console.log("IT IS THE SAME FY");
      try {
        const responsefile = await downloadFile(
          
          foundDocument.googledriveid
        );
        console.log('from downloadFile',responsefile.status,'status')
        res.status(200).json(responsefile.data.webContentLink);
      } catch (error) {
        if (error.response && error.response.status === 404) {
          res.status(404).json({ message: "Invalid ID" });
        }
        console.log(error);
      }
    } else {
      console.log("didnt match, its so over");
      res.status(404).json({ message: "wrong ID or Password" });
    }
  }
});

app.post("/deleteFile", async (req, res) => {
  console.log('came')
  const id = req.body.id;
  console.log(id);
  const foundDocument = await file.findOne({ fileid: id }).then((file)=>{return file;}, () => {res.status(404).json({ message: "Invalid ID" }); return null; })
  if(foundDocument){
  deleteFILE(foundDocument.googledriveid).then(
    () => {
      console.log("deleted successfully");
      res.status(201).json("success");
    },
    (error) => {console.log(error); res.status(404).json({message:'cant find it'})}
  );}else{
    console.log('not found')
  }

});
async function deleteIfOlderThanTwoHours() {
  const foundDocuments = await file.find();
  const twoHoursAgo = new Date();
  twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
  console.log(twoHoursAgo);

  for (const [index, document] of foundDocuments.entries()) {
    const createdAt = new Date(document.createdAt);
    const currentTime = new Date();
    const ageInMilliseconds = currentTime - createdAt;
    const ageInHours = (ageInMilliseconds / (1000 * 60 * 60)).toFixed(1);

    if (parseFloat(ageInHours) >= 2) {
      //await file.deleteOne({ googledriveid: document.googledriveid });
      await deleteFILE(document.googledriveid)
      console.log(`${index} got deleted`);
    } else {
      console.log(`${index} is ${ageInHours} hrs old`);
    }
  }
}
const getallfiles = async()=>{
const drive = google.drive({ version: "v3", auth: authClient });
const s = await drive.files.list({pageSize:500});


const e = Object.keys(s.data.files).length;
//for (let i =0; i<s.data.files.length; i++){
  console.log(e)
 /* const s1 = s.data.files
  for(let i =0; i<s1.length; i++){
    deleteFILE(s1[i].id)
  }*/
 /* for(var j in s.data.files[i]){
    console.log(i[id])
  }*/
//deleteFILE(s.data.files[0].id)

}

setInterval(deleteIfOlderThanTwoHours, 10 * 60 * 1000);


app.listen("3001", () => {
  console.log(`Server is running on port 3001`);
});
