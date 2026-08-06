import { browser_goto } from './goto';
import { browser_go_back, browser_go_forward, browser_reload } from './navigation';
import { browser_title } from './title';
import { browser_url } from './url';
import { browser_click } from './click';
import { browser_fill } from './fill';
import { browser_type } from './type';
import { browser_press } from './press';
import { browser_select } from './select';
import { browser_check, browser_uncheck } from './check';
import { browser_snapshot } from './snapshot';
import { browser_find } from './find';
import { browser_screenshot } from './screenshot';
import { browser_pdf } from './pdf';
import { browser_eval } from './eval';
import { browser_run_code } from './run-code';
import {
  browser_cookie_list,
  browser_cookie_get,
  browser_cookie_set,
  browser_cookie_delete,
  browser_localstorage_get,
  browser_localstorage_set,
  browser_localstorage_delete,
  browser_localstorage_list,
  browser_sessionstorage_get,
  browser_sessionstorage_set,
  browser_sessionstorage_delete,
  browser_sessionstorage_list,
} from './storage';
import {
  browser_tab_list,
  browser_tab_new,
  browser_tab_close,
  browser_tab_select,
} from './tab';
import {
  browser_state_save,
  browser_state_load,
} from './state';
// v0.5: Interaction Completion
import {
  browser_hover,
  browser_dblclick,
  browser_drag,
} from './interactions';
import {
  browser_dialog_accept,
  browser_dialog_dismiss,
} from './dialog';
import { browser_upload } from './upload';
import { browser_resize } from './resize';
import {
  browser_keydown,
  browser_keyup,
  browser_mousemove,
  browser_mousedown,
  browser_mouseup,
  browser_mousewheel,
  browser_actions_chain,
} from './advanced-input';
// v0.6: Web-First Assertions
import { browser_expect } from './expect';
// v0.7: Network & Debugging
import { browser_highlight } from './highlight';
import { browser_console } from './console';
import { browser_requests, browser_request } from './requests';
import { browser_route, browser_route_list, browser_unroute } from './route';
// v0.8: Device & Environment Emulation
import { browser_device, browser_device_list } from './device';
import { browser_emulate } from './emulate';
// v0.9: Locator inspection
import { browser_generate_locator } from './generate-locator';

export const tools: Record<string, (driver: any, params: any, response: any) => Promise<void>> = {
  browser_goto,
  browser_go_back,
  browser_go_forward,
  browser_reload,
  browser_title,
  browser_url,
  browser_click,
  browser_fill,
  browser_type,
  browser_press,
  browser_select,
  browser_check,
  browser_uncheck,
  browser_snapshot,
  browser_find,
  browser_screenshot,
  browser_pdf,
  browser_eval,
  browser_run_code,
  browser_cookie_list,
  browser_cookie_get,
  browser_cookie_set,
  browser_cookie_delete,
  browser_localstorage_get,
  browser_localstorage_set,
  browser_localstorage_delete,
  browser_localstorage_list,
  browser_sessionstorage_get,
  browser_sessionstorage_set,
  browser_sessionstorage_delete,
  browser_sessionstorage_list,
  browser_tab_list,
  browser_tab_new,
  browser_tab_close,
  browser_tab_select,
  browser_state_save,
  browser_state_load,
  // v0.5: Interaction Completion
  browser_hover,
  browser_dblclick,
  browser_drag,
  browser_dialog_accept,
  browser_dialog_dismiss,
  browser_upload,
  browser_resize,
  browser_keydown,
  browser_keyup,
  browser_mousemove,
  browser_mousedown,
  browser_mouseup,
  browser_mousewheel,
  browser_actions_chain,
  // v0.6: Web-First Assertions
  browser_expect,
  // v0.7: Network & Debugging
  browser_highlight,
  browser_console,
  browser_requests,
  browser_request,
  browser_route,
  browser_route_list,
  browser_unroute,
  // v0.8: Device & Environment Emulation
  browser_device,
  browser_device_list,
  browser_emulate,
  // v0.9: Locator inspection
  browser_generate_locator,
};
