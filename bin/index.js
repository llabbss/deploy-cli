#!/usr/bin/env node
/*
 * @Author: Oliver
 * @Date: 2025-05-23 11:11:06
 * @LastEditors: Oliver
 * @LastEditTime: 2025-05-26 16:53:49
 * @FilePath: /cli/bin/index.js
 */
import fs from "fs-extra";
import inquire from "inquirer";
import path from "path";
import ssh from "ssh2";
import chalk from "chalk";

const Client = ssh.Client;
const CWD = process.cwd();
inquire
  .prompt([
    {
      type: "input",
      name: "server",
      message: "请输入服务器地址",
      validate: value => {
        if (!value) {
          return "请输入服务器地址";
        }
        return true;
      }
    },
    {
      type: "input",
      name: "port",
      default: 22,
      message: "请输入服务器端口",
      validate: value => {
        if (!value) {
          return "请输入服务器端口";
        }
        return true;
      }
    },
    {
      type: "input",
      name: "user",
      message: "请输入服务器用户名",
      validate: value => {
        if (!value) {
          return "请输入服务器用户名";
        }
        return true;
      }
    },
    {
      type: "input",
      name: "remotePath",
      message: "请输入服务器部署路径",
      default: "/var/www/html",
      validate: value => {
        if (!value) {
          return "请输入服务器部署路径";
        }
        return true;
      }
    },
    {
      type: "input",
      name: "dist",
      message: "请输入本地项目路径",
      default: "./dist",
      validate: value => {
        if (!value) {
          return "请输入本地项目路径";
        }
        return true;
      }
    },
    {
      type: "input",
      name: "key",
      message: "请输入密钥路径",
      validate: value => {
        if (!value) {
          return "请输入密钥路径";
        }
        return true;
      }
    }
  ])
  .then(async answers => {
    try {
      await deploy(answers);
      console.log(chalk.green.bold("部署成功!"));
    } catch (e) {
      console.log(chalk.red.bold("部署失败!"));
      console.error("部署失败:", error.message);
    }
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
      console.log(chalk.green(`上传文件: ${remoteEntryPath}`));
      await new Promise((resolve, reject) => {
        sftp.fastPut(localEntryPath, remoteEntryPath, err => {
          if (err) {
            console.error(chalk.red(`${remoteEntryPath}上传失败:`, err));
            reject(err);
          } else {
            console.log(chalk.green(`${remoteEntryPath}上传成功`));
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
          console.log("SFTP 连接成功");
          // 开始上传
          uploadDirectory(sftp, path.join(CWD, dist), remotePath)
            .then(() => {
              console.log("所有文件上传成功");
              conn.end();
              resolve();
            })
            .catch(err => {
              console.error("上传失败:", err);
              conn.end();
              reject(err);
            });
        });
      })
      .on("error", err => {
        console.error("连接失败:", err);
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
