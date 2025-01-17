// This file is part of the Prusa Link Web
// Copyright (C) 2021 Prusa Research a.s. - www.prusa3d.com
// SPDX-License-Identifier: GPL-3.0-or-later

import * as graph from "../components/temperature_graph";
import upload from "../components/upload";
import cameras from "../components/cameras";
import { translate } from "../../locale_provider";
import * as job from "../components/job";
import { LinkState } from "../../state";

const load = (context) => {
  translate("home.link", { query: "#title-status-label" });
  upload.init("local", "", context.fileExtensions);
  graph.render();
  update(context);
  if (process.env['WITH_CAMERAS']) {
    cameras.update(context, updateSnapshots);
  }
};

const update = (context) => {
  const linkState = LinkState.fromApi(context.printer.state);
  job.update(context);
  upload.update(linkState);
  if (process.env['WITH_CAMERAS']) {
    cameras.update(context, updateSnapshots);
  }
};

const updateSnapshots = (list, removed) => {
  const listNode = document.getElementById("cameras-snapshots");

  removed.forEach(camera => {
    const cameraNode = cameras.getCameraNode(camera.id);
    if (cameraNode) {
      listNode.removeChild(cameraNode);
    }
  });

  list.filter(
    camera => camera.connected && !!camera.lastSnapshotUrl
  ).sort(
    (cam1, cam2) => cam1.lastSnapshotAt?.getTime() || 0 - cam2.lastSnapshotAt?.getTime() || 0
  ).forEach(camera => {
    const cameraNode = cameras.getCameraNode(camera.id);
    if (cameraNode) {
      updateCameraNode(cameraNode, camera);
    } else {
      const node = createCameraNode(camera);
      listNode.appendChild(node);
    }
  });
};

const createCameraNode = (camera) => {
  const template = document.getElementById("cameras-snapshots__item").content;
  const node = document.importNode(template, true);
  const listItemNode = node.querySelector("li");
  const nodeId = cameras.getCameraNodeId(camera.id);
  listItemNode.id = nodeId;

  const cameraId = camera.id;

  listItemNode.addEventListener("click", (e) => {
    cameras.updateCurrentCamera(cameraId);
    e.preventDefault();
  }, false);
    
  updateCameraNode(node, camera);

  return node
};

const updateCameraNode = (node, camera) => {
  const img = node.querySelector('img');
  img.src = camera.lastSnapshotUrl;
}

export default { load, update };
