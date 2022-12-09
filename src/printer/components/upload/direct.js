// This file is part of the Prusa Link Web
// Copyright (C) 2021 Prusa Research a.s. - www.prusa3d.com
// SPDX-License-Identifier: GPL-3.0-or-later

import { error, success } from "../toast";
import { handleError } from "../errors";
import { setDisabled } from "../../../helpers/element";
import { translate } from "../../../locale_provider";
import uploadRequest from "../../../helpers/upload_request";
import { attachConfirmModalToCheckbox } from "./confirm";
import { LinkState, OperationalStates } from "../../../state";

let isUploading = false;
let progress = 0;

function init(origin, path, fileExtensions) {
  translate("upld.direct.choose", {
    query: "#upld-direct p",
    file: fileExtensions.join(", "),
  });
  initInput(origin, path, fileExtensions);
  if (isUploading) {
    setState("uploading");
    setProgress(progress);
  }
}

function update(linkState) {
  const canStartPrinting = OperationalStates.includes(linkState);
  const startPrintCheckbox = document.querySelector("#upld-direct-start-pt");
  if (startPrintCheckbox) {
    startPrintCheckbox.setAttribute("data-link-state", linkState);
    if (!canStartPrinting) {
      startPrintCheckbox.checked = false;
    }
    setDisabled(startPrintCheckbox, !canStartPrinting);
  }
}

function initInput(origin, path, fileExtensions) {
  const input = document.querySelector('#upld-direct input[type="file"]');
  const startPtCheckbox = document.getElementById("upld-direct-start-pt");
  startPtCheckbox && attachConfirmModalToCheckbox(startPtCheckbox);
  if (input) {
    input.setAttribute("accept", fileExtensions.join(", "));
    input.onchange = () => {
      if (input.files.length > 0 && !isUploading) {
        let file = input.files[0];
        let print = startPtCheckbox?.checked || false;
        uploadFile(file, origin, path, print);
      }
    };
  }
}

function reset() {
  const input = document.querySelector('#upld-direct input[type="file"]');
  if (input) input.value = "";
  setProgress(0);
  setState("choose");
}

function setState(state) {
  isUploading = state === "uploading";
  const el = document.getElementById("upld-direct");
  if (el) el.setAttribute("data-state", state);
}

function setProgress(pct) {
  progress = pct;
  const el = document.getElementById("upld-progress");
  if (el) el.innerHTML = `${pct} %`;
}

const uploadFile = (file, origin, path, print) => {
  let url = `/api/v1/files/${origin}/${path}/${file.name}`;
  file.arrayBuffer().then((data) => {
    setState("uploading");
    setProgress(0);
    uploadRequest(url, data, {
      onProgress: (progress) => onProgressChanged(progress.percentage),
      print,
    })
      .then((result) => onUploadSuccess(file.display || file.name))
      .catch((result) => onUploadError(file.display || file.name, result))
      .finally(() => reset());
  });
};

function onProgressChanged(pct) {
  setState("uploading");
  setProgress(pct);
}

function onUploadSuccess(fileName) {
  const title = translate("ntf.success");
  const message = translate("ntf.upld-suc", { file_name: fileName });
  success(title, message);
}

function onUploadError(fileName, result) {
  if (result) {
    handleError(result);
  } else {
    const title = translate("ntf.error");
    const message = translate("ntf.upld-unsuc", { file_name: fileName });
    error(title, message);
  }
}

export default {
  init,
  update,
  get isUploading() {
    return isUploading;
  },
};
