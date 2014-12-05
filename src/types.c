/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Dummy C file for generating CTF data from the varpd header file
 */

#include "libvarpd_svp_prot.h"


int
main(int argc, char *argv[])
{
	svp_req_t		req;
	// svp_op_t		svp_op;
	// svp_status_t		svp_status;
	svp_vl2_req_t		vl2_req;
	svp_vl2_ack_t		vl2_ack;
	// svp_vl3_type_t	vl3_type;
	svp_vl3_req_t		vl3_req;
	svp_vl3_ack_t		vl3_ack;
	// svp_bulk_type_t	bulk_type;
	svp_bulk_req_t		bulk_req;
	svp_bulk_ack_t		bulk_ack;
	// svp_log_type_t	log_type;
	svp_log_req_t		log_req;
	svp_log_vl2_t		log_vl2;
	svp_log_vl3_t		log_vl3;
	svp_log_ack_t		log_ack;
	svp_lrm_req_t		lrm_req;
	svp_lrm_ack_t		lrm_ack;
	svp_shootdown_t		shootdown;

	return 0;
}
