/* SPDX-License-Identifier: Apache-2.0 */
#include <node_api.h>
#include <fcntl.h>
#include <stdint.h>
#include <sys/socket.h>
#include <unistd.h>

static napi_value receive(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg, result;
  int32_t fd;
  double number;
  napi_valuetype type;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok ||
      argc != 1 || napi_typeof(env, arg, &type) != napi_ok ||
      type != napi_number || napi_get_value_double(env, arg, &number) != napi_ok ||
      number < 3 || number > INT32_MAX ||
      napi_get_value_int32(env, arg, &fd) != napi_ok || number != (double)fd) {
    napi_throw_error(env, NULL, "Invalid inherited descriptor");
    return NULL;
  }

  int flags = fcntl(fd, F_GETFD), protected_flags;
  struct sockaddr_storage local, peer;
  socklen_t local_len = sizeof(local), peer_len = sizeof(peer), type_len = sizeof(int);
  int socket_type = 0;
  if (flags == -1 || fcntl(fd, F_SETFD, flags | FD_CLOEXEC) == -1 ||
      (protected_flags = fcntl(fd, F_GETFD)) == -1 ||
      (protected_flags & (flags | FD_CLOEXEC)) != (flags | FD_CLOEXEC) ||
      getsockopt(fd, SOL_SOCKET, SO_TYPE, &socket_type, &type_len) == -1 ||
      type_len != sizeof(int) || socket_type != SOCK_STREAM ||
      getsockname(fd, (struct sockaddr *)&local, &local_len) == -1 ||
      local.ss_family != AF_UNIX ||
      getpeername(fd, (struct sockaddr *)&peer, &peer_len) == -1 ||
      peer.ss_family != AF_UNIX) {
    close(fd);
    napi_throw_error(env, NULL, "Invalid inherited owner channel");
    return NULL;
  }
  if (napi_get_undefined(env, &result) != napi_ok) {
    close(fd);
    return NULL;
  }
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "receive", NAPI_AUTO_LENGTH, receive, NULL, &fn) != napi_ok ||
      napi_set_named_property(env, exports, "receive", fn) != napi_ok)
    return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
