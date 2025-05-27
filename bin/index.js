#!/usr/bin/env node
/*
 * @Author: Oliver
 * @Date: 2025-05-23 11:11:06
 * @LastEditors: Oliver
 * @LastEditTime: 2025-05-27 11:38:02
 * @FilePath: /cli/bin/index.js
 */
import fs from "fs-extra";
import inquire from "inquirer";
import path from "path";
import ssh from "ssh2";
import chalk from "chalk";
import { Command } from "commander";
import lang from "../i18n.js";
import deployConfig from "../deploy.config.js";

const { default: packageJson } = await import("../package.json", {
  assert: { type: "json" }
});
const { server, user, port, dist, remotePath, key } = deployConfig;
const Client = ssh.Client;
const CWD = process.cwd();
const program = new Command();

// 支持的语言列表
const SUPPORTED_LANGUAGES = {
  zhCn: "中文",
  enUs: "English"
};

// 获取当前语言
const getCurrentLanguage = () => {
  const options = program.opts();
  return options.language || "zhCn"; // 默认使用中文
};

// 翻译函数
const translate = (string, language = getCurrentLanguage()) => {
  if (lang[string] && lang[string][language]) {
    return lang[string][language];
  }
  return string; // 如果找不到翻译，返回原始字符串
};

program
  .name("deploy-cli")
  .version(packageJson.version)
  .option("-v, --v", "查看版本号")
  .option("-l, --language <language>", "选择语言 (zhCn/enUs)")
  .action(async () => {
    const options = program.opts();
    if (options.v) {
      console.log(
        chalk.green(`当前版本(current version)：${packageJson.version}`)
      );
      process.exit(0);
    }
    if (options.language) {
      if (!SUPPORTED_LANGUAGES[options.language]) {
        console.log(chalk.red("语言不支持(language not supported)"));
        process.exit(0);
      }
    }
  });
program.parse();
// 如果没有通过命令行指定语言，则显示语言选择提示
const startDeploy = async () => {
  let curLanguage = getCurrentLanguage();

  if (!program.opts().language) {
    const { language } = await inquire.prompt([
      {
        type: "list",
        name: "language",
        message: "请选择语言 / Please select language",
        choices: Object.entries(SUPPORTED_LANGUAGES).map(([value, name]) => ({
          value,
          name
        }))
      }
    ]);
    curLanguage = language;
  }

  // 继续部署流程
  const answers = await inquire.prompt([
    {
      type: "input",
      name: "server",
      message: translate("Please enter the server address", curLanguage),
      default: server || null,
      validate: value => {
        if (!value) {
          return translate("Please enter the server address", curLanguage);
        }
        return true;
      }
    },
    {
      type: "input",
      name: "port",
      default: 22,
      default: port || null,
      message: translate("Please enter the server port", curLanguage),
      validate: value => {
        if (!value) {
          return translate("Please enter the server port", curLanguage);
        }
        return true;
      }
    },
    {
      type: "input",
      name: "user",
      message: translate("Please enter the server username", curLanguage),
      default: user || null,
      validate: value => {
        if (!value) {
          return translate("Please enter the server username", curLanguage);
        }
        return true;
      }
    },
    {
      type: "input",
      name: "remotePath",
      message: translate(
        "Please enter the server deployment path",
        curLanguage
      ),
      default: remotePath || "/var/www/html",
      validate: value => {
        if (!value) {
          return translate(
            "Please enter the server deployment path",
            curLanguage
          );
        }
        return true;
      }
    },
    {
      type: "input",
      name: "dist",
      default: dist || "",
      message: translate("Please enter the local project path", curLanguage),
      default: "./dist",
      validate: value => {
        if (!value) {
          return translate("Please enter the local project path", curLanguage);
        }
        return true;
      }
    },
    {
      type: "input",
      name: "key",
      default: key || "",
      message: translate("Please enter the ssh key path", curLanguage),
      validate: value => {
        if (!value) {
          return translate("Please enter the ssh key path", curLanguage);
        }
        return true;
      }
    }
  ]);

  try {
    deploy(answers);
    console.log(
      chalk.green.bold(`${translate("Deployment successful", curLanguage)}!`)
    );
  } catch (e) {
    console.error(
      chalk.red.bold(`${translate("Deployment failed", curLanguage)}！`)
    );
  }
};

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

startDeploy();
