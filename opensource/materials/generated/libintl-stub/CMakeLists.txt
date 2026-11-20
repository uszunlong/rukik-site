cmake_minimum_required(VERSION 3.20)
project(libintl_stub C)
add_library(intl STATIC libintl.c)
set_target_properties(intl PROPERTIES
  POSITION_INDEPENDENT_CODE ON
  OUTPUT_NAME intl)
install(TARGETS intl ARCHIVE DESTINATION lib)
install(FILES libintl.h DESTINATION include)
