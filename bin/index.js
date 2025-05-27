#!/usr/bin/env node
/*
 * @Author: Oliver
 * @Date: 2025-05-23 11:11:06
 * @LastEditors: Oliver
 * @LastEditTime: 2025-05-27 09:50:54
 * @FilePath: /cli/bin/index.js
 */
import fs from "fs-extra";
import inquire from "inquirer";
import path from "path";
import ssh from "ssh2";
import chalk from "chalk";
import lang from "../i18n.json" assert { type: "json" };
import deployConfig from "../vite-deploy.config.json" assert { type: "json" };
console.log(deployConfig, "--deployConfig");
const { server, user, port, dist, remotePath, key } = deployConfig;
const Client = ssh.Client;
const CWD = process.cwd();
const translate = (string, language) => {
  if (lang[string][language]) {
    return lang[string][language];
  }
  console.log(string, "---string");
};
let curLanguage = null;
inquire
  .prompt([
    {
      type: "list",
      name: "language",
      message: "请选择语言",
      choices: [
        {
          value: "zhCn",
          name: "中文"
        },
        { name: "English", value: "enUs" }
      ]
    }
  ])
  .then(async ({ language }) => {
    curLanguage = language;
    inquire
      .prompt([
        {
          type: "input",
          name: "server",
          message: translate("Please enter the server address", language),
          default: server || null,
          validate: value => {
            if (!value) {
              return translate("Please enter the server address", language);
            }
            return true;
          }
        },
        {
          type: "input",
          name: "port",
          default: 22,
          default: port || null,
          message: translate("Please enter the server port", language),
          validate: value => {
            if (!value) {
              return translate("Please enter the server port", language);
            }
            return true;
          }
        },
        {
          type: "input",
          name: "user",
          message: translate("Please enter the server username", language),
          default: user || null,
          validate: value => {
            if (!value) {
              return translate("Please enter the server username", language);
            }
            return true;
          }
        },
        {
          type: "input",
          name: "remotePath",
          message: translate(
            "Please enter the server deployment path",
            language
          ),
          default: remotePath || "/var/www/html",
          validate: value => {
            if (!value) {
              return translate(
                "Please enter the server deployment path",
                language
              );
            }
            return true;
          }
        },
        {
          type: "input",
          name: "dist",
          default: dist || "",
          message: translate("Please enter the local project path", language),
          default: "./dist",
          validate: value => {
            if (!value) {
              return translate("Please enter the local project path", language);
            }
            return true;
          }
        },
        {
          type: "input",
          name: "key",
          default: key || "",
          message: translate("Please enter the ssh key path", language),
          validate: value => {
            if (!value) {
              return translate("Please enter the ssh key path", language);
            }
            return true;
          }
        }
      ])
      .then(answers => {
        try {
          deploy(answers);
          console.log(
            chalk.green.bold(`${translate("Deployment successful", language)}!`)
          );
        } catch (e) {
          console.error(
            chalk.red.bold(`${translate("Deployment failed", language)}！`)
          );
        }
      });
  });
async function uploadDirectory(sftp, localPath, remotePath, isRoot = true) {
  // 只在最外层加 dist
  const targetRemotePath = isRoot
    ? path.join(remotePath, "dist").replace(/\\/g, "/")
    : remotePath;
  //IMPORTANT: 这里一定需要先创建远程目录，不然上传不了
  await sftp.mkdir(targetRemotePath, true);
  const entries = fs.readdirSync(localPath, { withFileTypes: true });
  // 遍历本地路径
  for (const entry of entries) {
    const localEntryPath = path.join(localPath, entry.name);
    const remoteEntryPath = path
      .join(targetRemotePath, entry.name)
      // windows路径
      .replace(/\\/g, "/");
    if (entry.isDirectory()) {
      await uploadDirectory(sftp, localEntryPath, remoteEntryPath, false);
    } else {
      console.log(
        chalk.green(
          `${translate("Upload file", curLanguage)}: ${remoteEntryPath}`
        )
      );
      await new Promise((resolve, reject) => {
        sftp.fastPut(localEntryPath, remoteEntryPath, err => {
          if (err) {
            console.error(
              chalk.red(
                `${remoteEntryPath}${translate("Upload failed", curLanguage)}:`,
                err
              )
            );
            reject(err);
          } else {
            console.log(
              chalk.green(
                `${remoteEntryPath}${translate(
                  "Upload successful",
                  curLanguage
                )}`
              )
            );
            resolve();
          }
        });
      });
    }
  }
}

function deploy(options) {
  const { server, user, port, key, dist, remotePath } = options;
  if (!server || !user || !key || !dist || !remotePath) {
    throw new Error(
      "Missing required options: --server, --user, --key, --dist, --remotePath"
    );
  }

  const privateKey = fs.readFileSync(key, "utf8");
  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn
      .on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) {
            reject(err);
            return;
          }
          console.log(`SFTP 连接成功`);
          console.log(
            `SFTP ${translate("Connection successful", curLanguage)}`
          );
          // 开始上传
          uploadDirectory(sftp, path.join(CWD, dist), remotePath)
            .then(() => {
              console.log(
                `SFTP ${translate(
                  "All files uploaded successfully",
                  curLanguage
                )}`
              );
              conn.end();
              resolve();
            })
            .catch(err => {
              console.error(chalk.red("上传失败") + ":", err);
              console.error(
                chalk.red(`SFTP ${translate("Upload failed", curLanguage)}`),
                err
              );
              conn.end();
              reject(err);
            });
        });
      })
      .on("error", err => {
        console.error(
          chalk.red(translate("Connection failed", curLanguage)) + ":",
          err
        );
        reject(err);
      })
      .connect({
        host: server,
        port: port || 22,
        username: user,
        privateKey
      });
  });
}
