"use strict";

const fs = require('fs');
const path = require('path');
const config = require('./config.js');
const packageJson = JSON.parse(fs.readFileSync('./package.json'));

const logger = require('./libs/logger');
const async = require('async');
const mime = require('mime');

const cors = require('cors')
const express = require('express');
const app = express();

const bodyParser = require('body-parser');
const multer = require('multer');

const TaskManager = require('./libs/TaskManager');
const odmInfo = require('./libs/odmInfo');
const si = require('systeminformation');
const S3 = require('./libs/S3');

const auth = require('./libs/auth/factory').fromConfig(config);
const authCheck = auth.getMiddleware();
const taskNew = require('./libs/taskNew');

app.use(cors())
app.options('*', cors())

app.use(express.static('public'));
app.use('/swagger.json', express.static('docs/swagger.json'));

const axios = require('axios');
const FormData = require('form-data');


// dont need to connect to this again, find a way to import s3 from Task.js
const AWS = require('aws-sdk');
const { stringify } = require('querystring');

const s3 = new AWS.S3({
    region: 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
logger.info("AWS S3 Connected at index.js.")

const formDataParser = multer().none();
const urlEncodedBodyParser = bodyParser.urlencoded({extended: false});
const jsonBodyParser = bodyParser.json();

let taskManager;
let server;


app.post('/task/new/init', authCheck, taskNew.assignUUID, formDataParser, taskNew.handleInit);


app.post('/task/new/upload/:uuid', authCheck, taskNew.getUUID, taskNew.preUpload, taskNew.uploadImages, taskNew.handleUpload);


app.post('/task/new/commit/:uuid', authCheck, taskNew.getUUID, taskNew.handleCommit, taskNew.createTask);


app.post('/task/new', authCheck, taskNew.assignUUID, taskNew.uploadImages, (req, res, next) => {
    req.body = req.body || {};
    if ((!req.files || req.files.length === 0) && !req.body.zipurl) req.error = "Need at least 1 file or a zip file url.";
    else if (config.maxImages && req.files && req.files.length > config.maxImages) req.error = `${req.files.length} images uploaded, but this node can only process up to ${config.maxImages}.`;
    else if ((!req.files || req.files.length === 0) && req.body.zipurl) {
        const srcPath = path.join("tmp", req.id);
        fs.mkdirSync(srcPath);
    }
    next();
}, taskNew.createTask);

let getTaskFromUuid = (req, res, next) => {
    let task = taskManager.find(req.params.uuid);
    if (task) {
        req.task = task;
        next();
    } else res.json({ error: `${req.params.uuid} not found` });
};


app.get('/task/list', authCheck, (req, res) => {
    const tasks = [];
    for (let uuid in taskManager.tasks){
        tasks.push({uuid});
    }
    res.json(tasks);
});


app.get('/task/:uuid/info', authCheck, getTaskFromUuid, (req, res) => {
    const info = req.task.getInfo();
    if (req.query.with_output !== undefined) info.output = req.task.getOutput(req.query.with_output);
    res.json(info);
});


app.get('/task/:uuid/output', authCheck, getTaskFromUuid, (req, res) => {
    res.json(req.task.getOutput(req.query.line));
});


app.get('/task/:uuid/download/:asset', authCheck, getTaskFromUuid, (req, res) => {
    let asset = req.params.asset !== undefined ? req.params.asset : "all.zip";
    let filePath = req.task.getAssetsArchivePath(asset);
    if (filePath) {
        if (fs.existsSync(filePath)) {
            res.setHeader('Content-Disposition', `attachment; filename=${asset}`);
            res.setHeader('Content-Type', mime.getType(filePath));
            res.setHeader('Content-Length', fs.statSync(filePath).size);

            const filestream = fs.createReadStream(filePath);
            filestream.pipe(res);
        } else {
            res.json({ error: "Asset not ready" });
        }
    } else {
        res.json({ error: "Invalid asset" });
    }
});


let uuidCheck = (req, res, next) => {
    if (!req.body.uuid) res.json({ error: "uuid param missing." });
    else next();
};

let successHandler = res => {
    return err => {
        if (!err) res.json({ success: true });
        else res.json({ success: false, error: err.message });
    };
};


app.post('/task/cancel', urlEncodedBodyParser, jsonBodyParser, authCheck, uuidCheck, (req, res) => {
    taskManager.cancel(req.body.uuid, successHandler(res));
});


app.post('/task/remove', urlEncodedBodyParser, jsonBodyParser, authCheck, uuidCheck, (req, res) => {
    taskManager.remove(req.body.uuid, successHandler(res));
});


app.post('/task/restart', urlEncodedBodyParser, jsonBodyParser, authCheck, uuidCheck, (req, res, next) => {
    if (req.body.options){
        odmInfo.filterOptions(req.body.options, (err, options) => {
            if (err) res.json({ error: err.message });
            else {
                req.body.options = options;
                next();
            }
        });
    } else next();
}, (req, res) => {
    taskManager.restart(req.body.uuid, req.body.options, successHandler(res));
});


app.get('/options', authCheck, (req, res) => {
    odmInfo.getOptions((err, options) => {
        if (err) res.json({ error: err.message });
        else res.json(options);
    });
});

app.get('/info', authCheck, (req, res) => {
    async.parallel({
        cpu: cb => si.cpu(data => cb(null, data)),
        mem: cb => si.mem(data => cb(null, data)),
        engineVersion: odmInfo.getVersion,
        engine: odmInfo.getEngine
    }, (_, data) => {
        const { cpu, mem, engineVersion, engine } = data;

        // For testing
        if (req.query._debugUnauthorized){
            res.writeHead(401, "unauthorized")
            res.end();
            return;
        }

        res.json({
            version: packageJson.version,
            taskQueueCount: taskManager.getQueueCount(),
            totalMemory: mem.total,
            availableMemory: mem.available,
            cpuCores: cpu.cores,
            maxImages: config.maxImages,
            maxParallelTasks: config.parallelQueueProcessing,
            engineVersion,
            engine
        });
    });
});


app.get('/auth/info', (req, res) => {
    res.json({
        message: "Authentication not available on this node", 
        loginUrl: null,
        registerUrl: null
    });
});


app.post('/auth/login', (req, res) => {
    res.json({error: "Not available"});
});


app.post('/auth/register', (req, res) => {
    res.json({error: "Not available"});
});


app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.json({error: err.message});
});

let gracefulShutdown = done => {
    async.series([
        cb => taskManager.dumpTaskList(cb),
        cb => auth.cleanup(cb),
        cb => {
            logger.info("Closing server");
            server.close();
            logger.info("Exiting...");
            process.exit(0);
        }
    ], done);
};

// listen for TERM signal .e.g. kill
process.on('SIGTERM', gracefulShutdown);

// listen for INT signal e.g. Ctrl-C
process.on('SIGINT', gracefulShutdown);

// Startup
if (config.test) {
    logger.info("Running in test mode");
    if (config.testSkipOrthophotos) logger.info("Orthophotos will be skipped");
    if (config.testSkipDems) logger.info("DEMs will be skipped");
    if (config.testDropUploads) logger.info("Uploads will drop at random");
}

if (!config.hasUnzip) logger.warn("The unzip program is not installed, (certain unzip operations might be slower)");
if (!config.has7z) logger.warn("The 7z program is not installed, falling back to legacy (zipping will be slower)");


let commands = [
    cb => odmInfo.initialize(cb),
    cb => auth.initialize(cb),
    cb => S3.initialize(cb),
    cb => { 
        TaskManager.initialize(cb);
        taskManager = TaskManager.singleton();
    },
    cb => {
        const startServer = async (port, cb) => {
            server = app.listen(parseInt(port), async (err) => {
                if (!err) {
                    logger.info('Server has started on port ' + String(port))

                    // # - # - # - # - # - # - # - # - # - #
                    // hit api endpoints to start a task here, take info from environment variables

                    // hitting the first api to get uuid
                    let response_uuid = await get_uuid()
                    logger.info(`1/3 API endpoint hit successfully: ${response_uuid}`)

                    // # - # - # - # - # - # - # - # - # - #
                    // getting the files from s3
                    
                    await download_s3_files()

                    // # - # - # - # - # - # - # - # - # - #
                    // hitting the 2nd api to upload images

                    await upload_s3_images(response_uuid)
                    logger.info(`2/3 API endpoint hit successfully: files uploaded`)


                    logger.info('all api endpoints have been hit, get down!')
                };
                cb(err);
            });
            server.on("error", cb);
        };

        const tryStartServer = (port, cb) => {
            startServer(port, (err) => {
                if (err && err.code === 'EADDRINUSE' && port < 5000){
                    tryStartServer(port + 1, cb);
                }else cb(err);
            });
        };

        if (Number.isInteger(parseInt(config.port))){
            startServer(config.port, cb);
        }else if (config.port === "auto"){
            tryStartServer(3000, cb);
        }else{
            cb(new Error(`Invalid port: ${config.port}`));
        }
    }
];

if (config.powercycle) {
    commands.push(cb => {
        logger.info("Power cycling is set, application will shut down...");
        process.exit(0);
    });
}

async.series(commands, err => {
    if (err) {
        logger.error(err.message);
        process.exit(1);
    }
});





// # - # - # - # - # - # - # - # - # - # - # -
// # - # FUNCTIONS FOR S3 INTEGRATION # - # - 

async function get_uuid() {
    let data = new FormData();
    data.append('name', 'api-task');
    data.append('webhook', '');
    data.append('skipPostProcessing', 'True');
    data.append('options', '[]');

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'http://localhost:3000/task/new/init',
        headers: { ...data.getHeaders() },
        data : data
    };
                      
    const response = await axios.request(config);
    return response.data.uuid
}



async function download_s3_files() {
    let downloadDir = 'download-dir'
    // prefix is also to be provided as environment variable
    const listedObjects = await s3.listObjectsV2({Bucket: 'node-odm-test-bucket', Prefix: '8g93j-images'}).promise();
    fs.mkdirSync(downloadDir, { recursive: true });

    for (const object of listedObjects.Contents) {
        const fileKey = object.Key;
        const fileName = path.basename(fileKey);
        const filePath = path.join(downloadDir, fileName);

        const data = await s3.getObject({Bucket: 'node-odm-test-bucket', Key: fileKey}).promise();
        fs.writeFileSync(filePath, data.Body);

        logger.info(`Downloaded ${fileKey} to ${filePath}`);
    }
}

async function upload_s3_images(uuid) {
    let data = new FormData();

    let dirPath = 'download-dir'
    fs.readdir(dirPath, (err, files) => {
        if (err) {
            logger.error('Error reading directory:', err);
            return;
        }
        files
            .filter(file => file.endsWith('.JPG'))   // not just exclusive to .jpg 
            .forEach(file => {
                logger.info(`reading file ${file.fileName}`)
                data.append('images', fs.createReadStream(`${dirPath}/${file.fileName}`));
            });
    });

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: `http://localhost:3000/task/new/upload/${uuid}`,
        headers: { ...data.getHeaders() },
        data : data
    };
      
    let response = await axios.request(config)
    logger.info(JSON.stringify(response.data))
}