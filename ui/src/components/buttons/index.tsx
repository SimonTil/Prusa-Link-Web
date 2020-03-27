// This file is part of Prusa-Connect-Local
// Copyright (C) 2018-2019 Prusa Research s.r.o. - www.prusa3d.com
// SPDX-License-Identifier: GPL-3.0-or-later

import { h } from "preact";
import "./style.scss";

let icons = icon_id => null;
if (process.env.IS_SL1) {
  const exp_times = require("../../assets/exposure_times_color.svg");
  const refill = require("../../assets/refill_color.svg");
  icons = function name(icon_id: string) {
    switch (icon_id) {
      case "exp-times":
        return exp_times;
      case "refill":
        return refill;
      default:
        return null;
    }
  };
}

interface P {
  text: string;
  disabled: boolean;
  onClick(e: MouseEvent): void;
  wrap: boolean;
}

interface PAction extends P {
  icon: string;
}

export const YesButton: preact.FunctionalComponent<P> = ({
  text,
  disabled,
  onClick,
  wrap
}) => {
  return (
    <button
      class={
        "button prusa-button-confirm title is-size-3 is-size-6-desktop" +
        (wrap ? "prusa-button-margin" : "")
      }
      onClick={e => onClick(e)}
      disabled={disabled}
    >
      <img
        class="media-left image is-24x24"
        src={require("../../assets/yes_color.svg")}
      />
      {text}
    </button>
  );
};

export const NoButton: preact.FunctionalComponent<P> = ({
  text,
  disabled,
  onClick,
  wrap
}) => {
  return (
    <button
      class={
        "button prusa-button-cancel title is-size-3 is-size-6-desktop" +
        (wrap ? "prusa-button-margin" : "")
      }
      onClick={e => onClick(e)}
      disabled={disabled}
    >
      <img
        class="media-left image is-24x24"
        src={require("../../assets/cancel.svg")}
      />
      {text}
    </button>
  );
};

export const ActionButton: preact.FunctionalComponent<PAction> = ({
  text,
  disabled,
  onClick,
  wrap,
  icon
}) => {
  return (
    <button
      class={
        "button prusa-button-grey title is-size-3 is-size-6-desktop" +
        (wrap ? "prusa-button-margin" : "")
      }
      onClick={e => onClick(e)}
      disabled={disabled}
    >
      <img class="media-left image is-24x24" src={icons(icon)} />
      {text}
    </button>
  );
};
