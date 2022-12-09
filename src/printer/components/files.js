// This file is part of the Prusa Link Web
// Copyright (C) 2021 Prusa Research a.s. - www.prusa3d.com
// SPDX-License-Identifier: GPL-3.0-or-later

import formatData from "./dataFormat.js";
import joinPaths from "../../helpers/join_paths";
import upload from "./upload";
import { getJson, getImage } from "../../auth.js";
import { getValue } from "./updateProperties.js";
import { handleError } from "./errors";
import { navigateShallow } from "../../router.js";
import { translate, translateLabels } from "../../locale_provider.js";
import {
  createFolder,
  deleteFolder,
  deleteFile,
  downloadFile,
  renameFolder,
  renameFile,
  startPrint,
} from "./fileActions.js";
import printer from "../index";
import scrollIntoViewIfNeeded from "../../helpers/scroll_into_view_if_needed.js";
import * as job from "./job";
import { initKebabMenu } from "./kebabMenu.js";
import { setEnabled, setVisible } from "../../helpers/element.js";
import storage from "./storage.js";
import { LinkState } from "../../state.js";
import { setButtonLoading, unsetButtonLoading } from "../../helpers/button.js";

const SORT_FIELDS = process.env["WITH_NAME_SORTING_ONLY"]
  ? ["name"]
  : ["name", "date", "size"];
let lastData = null;
let intersectionObserver = null;
let previewLazyQueue = [];

const STORAGE_TYPES = ["LOCAL", "USB", "SDCARD"];

/**
 * file context
 */
const metadata = {
  origin: null,
  current_path: [],
  storages: {},
  files: [],
  eTag: null,
  sort: {
    field: process.env["WITH_NAME_SORTING_ONLY"] ? "name" : "date",
    order: process.env["WITH_NAME_SORTING_ONLY"] ? "asc" : "desc",
  },
};

const getInitialMetadataFiles = (data) => {
  if (process.env.PRINTER_TYPE === "fdm") {
    return data.files;
  }

  let files = [
    {
      name: "local",
      display: "Local",
      origin: "local",
      path: "/local",
      type: "folder",
      children: data.files.filter((elm) => elm.origin === "local"),
    },
  ];
  let usb_files = data.files.filter((elm) => elm.origin === "usb");
  if (usb_files.length > 0) {
    files.push({
      name: "usb",
      display: "USB",
      origin: "usb",
      path: "/usb",
      type: "folder",
      children: usb_files,
    });
  }
  return files;
};

const sortFiles = (files) => {
  const compareFiles = (f1, f2) => {
    if (f1.type === "folder" && f2.type !== "folder") return -1;
    if (f1.type !== "folder" && f2.type === "folder") return 1;

    const order = metadata.sort.order === "desc" ? -1 : 1;

    switch (metadata.sort.field) {
      case "date":
        const ts1 = f1.date || 0;
        const ts2 = f2.date || 0;
        return order * (ts1 - ts2);
      case "size":
        const s1 = f1.size || 0;
        const s2 = f2.size || 0;
        return order * (s1 - s2);
      case "name":
      default:
        return order * f1.display.localeCompare(f2.display);
    }
  };
  files.sort(compareFiles);
  return files;
};

const updateStorage = (opts = {}) => {
  getJson("/api/v1/storage", {
    // headers: { "If-None-Match": metadata.eTag },
  }).then((result) => {
    const list = result.data?.storage_list;
    let redrawTabs = !!opts.redraw;
    let redrawStorageDetails = !!opts.redraw;
    if (list) {
      list.forEach((entry) => {
        const storageType = entry.type;
        const storageData = {
          name: entry.name,
          path: entry.path,
          available: entry.available,
          readOnly: entry.ro,
          freeSpace: entry.free_space,
          totalSpace: entry.total_space,
          // NOTE: unused on FE
          // systemFiles: entry.system_files,
          // printFiles: entry.print_files,
        };

        if (storageType in metadata.storages) {
          const storage = metadata.storages[storageType];

          if (storage.available !== storageData.available) {
            redrawTabs = true;
            // check if selected storage became inavailable (i.e. USB was disconnected)
            if (metadata.origin === storageType && !storageData.available) {
              metadata.origin = false;
            }
          }

          if (
            storage.freeSpace !== storageData.freeSpace &&
            metadata.origin === storageType
          ) {
            redrawStorageDetails = true;
          }
        } else {
          redrawTabs = true;
          redrawStorageDetails = true;
        }

        metadata.storages[storageType] = storageData;
      });
    }

    if (!metadata.origin) {
      const storage = Object.keys(metadata.storages).find(
        (storage) => metadata.storages[storage].available
      );
      if (storage) {
        selectStorage(storage);
      }
    }

    if (redrawTabs) {
      storage.update(
        metadata.storages,
        metadata.origin,
        selectStorage,
        redrawStorageDetails
      );
    }
  });
};

const updateFiles = (opts = {}) => {
  const selectedStorage = metadata.origin;
  if (!selectStorage) return;

  const storage = metadata.storages[selectedStorage];
  if (!storage) return;

  // TODO: storage paths must be unified on printer's side
  // there must be `storage.path` not `.name`
  const path = [storage.name, ...metadata.current_path.slice(1)].join("/");
  const url = `/api/files/path/${path}`;
  let lastETag = metadata.eTag;

  if (opts.force) {
    metadata.eTag = null;
    lastETag = null;
    initUpload(printer.getContext());
  }

  getJson(url, {
    headers: { "If-None-Match": lastETag },
  }).then((result) => {
    const eTag = result.eTag;
    if (eTag !== lastETag) {
      metadata.eTag = eTag;
      metadata.files = result.data.files;
      // in case if files on the printer have changed, clearing on response makes more sense
      clearFiles();
      redrawFiles();
    }
  });
};

const clearFiles = () => {
  const files = document.getElementById("files");
    if (files) {
    while (files?.firstChild) {
      files.removeChild(files.firstChild);
    }
    files.appendChild(createCurrent());
    if (metadata.current_path.length > 1) {
      files.appendChild(createUp());
    } 
  }
};

const redrawFiles = () => {
  const filesNode = document.getElementById("files");
  if (filesNode) {

    for (let entry of sortFiles(metadata.files)) {
      if (entry.type === "folder") {
        // TODO: Cache file/folder count or count async.
        const filesCount = countFilesRecursively(entry);
        const folders = countFoldersRecursively(entry);
        filesNode.appendChild(
          createNodeFolder(entry.display || entry.name, entry.path, {
            files: filesCount,
            folders,
          })
        );
      } else {
        filesNode.appendChild(createFile(entry));
      }
    }
  }
};

/**
 * update file page
 * @param {object} context
 */
export const update = (context) => {
  const linkState = LinkState.fromApi(context.printer.state);
  updateStorage();
  updateFiles();
  job.update(context, true);
  upload.update(linkState);
};

function initUpload(context) {
  const origin = metadata.origin;
  const storage = metadata.storages[origin];
  const path = joinPaths(getCurrentPath());
  upload.init(storage.path.replace("/", ""), path, context?.fileExtensions);
  upload.hide(!!storage?.readOnly);
}

/**
 * load files page
 */
export function load(context) {
  /*
  getJson("/api/v1/storage")
    .then(res => console.log("storage", res.data));

  getJson("/api/v1/files/sdcard/SD Card/house")
    .then(res => console.log("sdcard/house", res.data))
  getJson("/api/files/path/PrusaLink gcodes")
    .then(res => console.log("local", res.data))
  getJson("/api/files/path/SD Card")
    .then(res => console.log("sdcard", res.data))
  */

  metadata.eTag = null;

  translate("proj.link", { query: "#title-status-label" });

  if (!intersectionObserver) {
    const config = {
      rootMargin: "0px 0px 50px 0px",
      threshold: 0,
    };

    intersectionObserver = new IntersectionObserver((entries, self) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (process.env.WITH_PREVIEW_LAZY_QUEUE) {
            const loadPreviewQueued = () => {
              if (previewLazyQueue.length) {
                const target = previewLazyQueue[0];
                getImage(target.getAttribute("data-src"))
                  .then(({ url }) => {
                    target.src = url;
                  })
                  .finally(() => {
                    self.unobserve(target);
                    previewLazyQueue.shift();
                    loadPreviewQueued();
                  });
              }
            };
            previewLazyQueue.push(entry.target);
            if (previewLazyQueue.length === 1) {
              loadPreviewQueued();
            }
          } else {
            getImage(entry.target.getAttribute("data-src")).then(({ url }) => {
              entry.target.src = url;
            });
          }
        }
      });
    }, config);
  }

  if (!context) {
    context = printer.getContext();
  }

  const previewFile = job.getPreviewFile();
  if (previewFile) {
    const file = findFile(previewFile.origin, previewFile.path);
    if (!file) {
      job.selectFilePreview(null);
    } else if (file.date > previewFile.data) {
      job.selectFilePreview(file);
    }
  }
  job.update(context, true);

  storage.load();

  updateStorage({redraw: true});
  updateFiles();
}

/**
 * Create a element folder / file / up buttons
 * @param {string} templateName - type
 * @param {string} name - title
 * @param {function} cb - callback when click
 */
function createElement(templateName, name, cb) {
  const templateFolder = document.getElementById(templateName).content;
  const elm = document.importNode(templateFolder, true);
  if (cb) {
    elm.querySelector(".node").addEventListener("click", (e) => {
      cb(e);
      e.preventDefault();
    });
  }
  elm.querySelector("#name")?.appendChild(document.createTextNode(name));
  return elm;
}

/**
 * Create a folder element
 * @param {string} name
 * @param {string} path
 * @param {{files: number, folders: number} | undefined} details (optional)
 * @param {string|undefined} origin (optimal)
 */
function createNodeFolder(name, path, details, origin) {
  const elm = createElement("node-folder", name, () => {
    if (origin) metadata.origin = origin;

    if (!origin && process.env.PRINTER_TYPE === "sla") {
      metadata.current_path = [
        metadata.origin,
        ...path.split("/").filter((str) => str !== ""),
      ];
    } else {
      metadata.current_path.push(path.replace("/", ""));
    }
    clearFiles();
    updateFiles({force: true});
  });

  const filesText = details?.files ? `${details.files} files` : null;
  const foldersText = details?.folders ? `${details.folders} folders` : null;
  const detailsText = [filesText, foldersText]
    .filter((i) => i != null)
    .join(" | ");

  elm.getElementById("details").innerHTML = detailsText;

  const deleteBtn = elm.getElementById("delete");
  if (deleteBtn) {
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteFolder();
    };
  }
  const renameBtn = elm.getElementById("rename");
  if (renameBtn) {
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      renameFolder();
    };
  }
  return elm;
}

function createCurrent() {
  const current_path = [...metadata.current_path];
  const current_folder = current_path.pop() || "Root";
  const component = createElement("node-current", current_folder);
  component.getElementById("path").innerHTML = `${joinPaths(current_path)}/`;

  const createBtn = component.getElementById("create");
  if (createBtn) {
    createBtn.onclick = (e) => {
      e.stopPropagation();
      createFolder();
    };
  }

  component.querySelector("#sort-by-name p").innerText = translate(
    "sort.by-name"
  );
  if (!process.env["WITH_NAME_SORTING_ONLY"]) {
    component.querySelector("#sort-by-date p").innerText = translate(
      "sort.by-date"
    );
    component.querySelector("#sort-by-size p").innerText = translate(
      "sort.by-size"
    );
  }

  component
    .querySelector(`#sort-by-${metadata.sort.field}`)
    .classList.add(metadata.sort.order);

  SORT_FIELDS.forEach((field) => {
    component.getElementById(`sort-by-${field}`).addEventListener(
      "click",
      (e) => {
        const newToggle = document.getElementById(`sort-by-${field}`);
        const oldToggle = document.getElementById(
          `sort-by-${metadata.sort.field}`
        );

        oldToggle.classList.remove(metadata.sort.order);

        const order =
          metadata.sort.field === field
            ? metadata.sort.order === "asc"
              ? "desc"
              : "asc"
            : "asc";

        newToggle.classList.add(order);

        metadata.sort.field = field;
        metadata.sort.order = order;

        clearFiles();
        redrawFiles();
      },
      false
    );
  });

  return component;
}

/**
 * create a up button element
 */
function createUp() {
  const elm = createElement("node-up", "", () => {
    metadata.current_path.pop();
    clearFiles();
    updateFiles({force: true});
  });
  translateLabels(elm);
  return elm;
}

/**
 * callback when click on file element
 * @param {object} node
 */
const onClickFile = (node) => {
  showPreview(node);
};

function showPreview(file) {
  const currentPreview = job.getPreviewFile();
  if (
    !currentPreview ||
    currentPreview.origin !== file.origin ||
    currentPreview.path !== file.path
  ) {
    job.selectFilePreview(file);
    job.update(printer.getContext(), true);
  }

  const jobElement = document.getElementById("job");
  if (jobElement) {
    scrollIntoViewIfNeeded(jobElement);
  }
}

/**
 * Create a file element
 * @param {object} node
 */
function createFile(node) {
  const elm = createElement("node-file", node.display || node.name, (e) =>
    onClickFile(node)
  );
  const nodeDetails = elm.querySelector(".node-details");
  nodeDetails.querySelectorAll(".details").forEach((element) => {
    translateLabels(element);
    const value = getValue(element.dataset.where, node);
    if (value) {
      const data = formatData(element.dataset.format, value);
      element.querySelector("p[data-value]").innerHTML = data;
    } else {
      nodeDetails.removeChild(element);
    }
  });
  if (node.refs && node.refs.thumbnailBig) {
    const img = elm.querySelector("img.node-img");
    img.setAttribute(
      "data-src",
      node.date
        ? `${node.refs.thumbnailBig}?ct=${node.date}`
        : node.refs.thumbnailBig
    );
    intersectionObserver.observe(img);
  }

  initKebabMenu(elm);
  setupFileButtons(node, elm);
  translateLabels(elm);
  return elm;
}

function setupFileButtons(node, elm) {
  // Setup buttons
  const paths = getNodeFilePaths(node.name);
  const fileUrl = joinPaths("/api/files/", ...paths);

  const detailsBtn = elm.getElementById("details");
  if (detailsBtn) {
    detailsBtn.onclick = (e) => {
      onClickFile(node);
    };
  }
  const startBtn = elm.getElementById("start");
  if (startBtn) {
    startBtn.onclick = (e) => {
      e.stopPropagation();
      startPrint();
    };
  }
  const renameBtn = elm.getElementById("rename");
  if (renameBtn) {
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      renameFile();
    };
  }

  const deleteBtn = elm.getElementById("delete");
  if (deleteBtn) {
    setEnabled(deleteBtn, !node.ro && node.refs?.resource);
    deleteBtn.onclick = (e) => {
      deleteFile(node);
      e.stopPropagation();
    };
  }

  const downloadBtn = elm.getElementById("download");
  if (downloadBtn) {
    setEnabled(downloadBtn, node.refs?.download);
    downloadBtn.onclick = (e) => {
      setButtonLoading(downloadBtn);
      downloadFile(node, () => unsetButtonLoading(downloadBtn));
      e.stopPropagation();
    };
  }
}

/**
 * Get current path. Not include origin.
 * For SlA without "local" or "sdcard"
 * For FDM without "Prusa Link gcodes" or "SD Card"
 */
function getCurrentPath() {
  return metadata.current_path.slice(1, metadata.current_path.length);
}

function getNodeFilePaths(nodeName) {
  const paths = [
    metadata.origin,
    ...(process.env.PRINTER_TYPE === "fdm"
      ? metadata.current_path
      : getCurrentPath()),
    nodeName,
  ];
  return paths;
}

function countFoldersRecursively(node) {
  const folders = node?.children?.filter((i) => i.type === "folder") || [];
  let count = folders.length || 0;
  folders.forEach((i) => (count += countFoldersRecursively(i)));
  return count;
}

function countFilesRecursively(node) {
  const files = node?.children?.filter((i) => i.type === "machinecode") || [];
  const folders = node?.children?.filter((i) => i.type === "folder") || [];
  let count = files.length || 0;
  folders.forEach((i) => (count += countFilesRecursively(i)));
  return count;
}

function selectStorage(origin) {
  clearFiles();
  if (origin in metadata.storages) {
    const storage = metadata.storages[origin];
    if (storage.available) {
      metadata.origin = origin;
      metadata.current_path = [storage.name];
      clearFiles();
      updateFiles({force: true});
    }
  }
}

function findFile(origin, path) {
  if (!origin || !path) return null;

  let target = metadata.files.find((i) => i.origin === origin);
  const pathSegments =
    process.env.PRINTER_TYPE === "fdm"
      ? path
          .split("/")
          .filter((i) => i)
          .slice(1)
      : path.split("/").filter((i) => i);

  for (const segment of pathSegments) {
    if (!target) break;
    target = target.children.find((i) => i.name === segment);
  }

  return target?.type === "machinecode" ? target : null;
}

export default { load, update };
