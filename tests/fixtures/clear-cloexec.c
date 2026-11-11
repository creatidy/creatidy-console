/* SPDX-License-Identifier: Apache-2.0 */
#include <node_api.h>
#include <fcntl.h>

static napi_value clear_flag(napi_env env, napi_callback_info info) {
  (void)info;
  int flags = fcntl(3, F_GETFD);
  if (flags == -1 || fcntl(3, F_SETFD, flags & ~FD_CLOEXEC) == -1) {
    napi_throw_error(env, NULL, "Synthetic descriptor setup failed");
    return NULL;
  }
  napi_value result;
  if (napi_get_undefined(env, &result) != napi_ok) return NULL;
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "clear", NAPI_AUTO_LENGTH, clear_flag, NULL, &fn) != napi_ok ||
      napi_set_named_property(env, exports, "clear", fn) != napi_ok) return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
