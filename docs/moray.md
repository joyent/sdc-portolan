# Portolan Moray Layout

## Some Moray background

First, a bit of pertinent moray information, just so we're all on the same
page.  Moray stores records in buckets, which map to tables in postgres.
Each bucket has a schema, where you can define typed indexes for various keys
in the JSON values you store.  Only indexed fields can be used to filter the
results in a bucket.

For example, if you have a bucket with an index on "ip" of type `number`, and
you store a record that has `{ "ip": 173561860 }`, you can then do a
listObjects of records in that bucket that have ip=173561860 to find that
record.

Also of note:

- You can update multiple records in one Postgres transaction, and these
  updates can span buckets.
- You can update indexed fields in multiple records based on a filter.  For
  example, NAPI uses this to unset the `primary` field in nics, by setting
  primary: false in nics where belongs_to_uuid=<zone UUID of the nic currently>
  being set to primary>


## Principles

The overriding principle is: make lookups as fast as possible.  These lookups
are in the customer data path, so they need to be both quick and reliable.
The corollaries from this main principle are therefore:

1) Precompute as much as possible on inserts, if it makes lookups simpler.
2) Try to minimize the number of moray calls per lookup.
3) Try to minimize transformations of data - the closer it is at rest to what
   goes on the wire, the better.
4) Cache infrequently changing data heavily with a long TTL, if possible.


## Tables

This section just gives the schemas and a brief description of the tables
involved.  See the "Use Cases" section below for how they're used in the
various lookups in the system.

Note that some of the types I've used are made up - there's no "port" type in
moray, for example.  They're just meant to be descriptive.

### vnet_mac_ip table

This table maps MAC addresses to IPs, as well as CN IDs to the MACs on that
system.

   field        |   type    | Index? | Description
----------------|-----------|--------|-----------------------
mac             | MAC addr  | yes    | MAC address
ip              | IP addr   | yes    | IP address
cn_id           | UUID      | yes    | CN this MAC resides on
vid             | UUID      | yes    | vnet ID
version         | Int       |        | per-record version
deleted         | Bool      |        | tombstone indicator
\_key           |           |        | tuple of [ip,vid]

Each customer controls their entire network, so we don't need per-record
owner_uuid information (unlike other NAPI networks).  We can still create a
matching record in the napi_nics bucket to hold other nic details such as
antispoof settings, and create / delete both in a transaction.

\_key is the tuple of [ip, vid] for two reasons:

- This allows an L3 lookup (see below), to be fast - we know both the IP and
  VID at lookup time, so it's a SELECT on the primary key.
- This easily prevents duplicate IPs from being created on a VXLAN, since
  there will be a key collision.

Open questions:

- Should we include the VLAN ID here?
- What's an acceptable time period for garbage-collecting tombstoned records?


### portolan_underlay_mappings table

This table maps CN UUIDs to the IPs port that their underlay.  This data changes very infrequently
(basically only when a CN is booted onto a platform that supprts VxLAN or is
decommissioned), so we can cache the bejesus out of this in memory.

   field    |   type    | Index? | Description
------------|-----------|--------|-----------------------
cn_id       | UUID      | yes    | CN this MAC resides on
ip          | IP addr   | yes    | IP address
port        | port      | yes    | IP address

I should note that we might not even need this to be its own table.  If all
underlay devices are running on the same port, this is just a lookup to the
normal napi_nics table to get the nic with the "underlay" nic tag (for
example).


### cn_net_events table

This holds log events for the various CNs.

   field    |   type    | Index? | Description
------------|-----------|--------|-----------------------
cn_id       | UUID      | yes    | CN this MAC resides on
vid         | UUID      | yes    | vnet ID
record      | JSON      |        | log record to be pulled onto the CN
id          | int       | yes    | log record ID - used for deleting later

The "record" field is a full JSON copy of the record at the time it was
inserted into the log


### napi_vnetworks table

This isn't really the focus of this document, but this would be the table,
akin to the `napi_networks` table, that holds the API-facing metadata
for these networks.  This metadata is necessary for provisioning and updating
VMs on networks, but not for lookups.

   field     |   type    | Index? | Description
-------------|-----------|--------|-----------------------
vid          | UUID      | yes    | vnet ID
name         | string    |        | network name / description
owner_uuid   | UUID      | yes    | network owner
start_ip     | IP addr   | yes    | provision start IP
end_ip       | IP addr   | yes    | provision end IP
subnet_start | IP addr   | yes    | start IP
subnet_bits  | number    | yes    | CIDR suffix (eg: 24 for a /24)
... etc ...


## Actions / Use cases

### VL2 lookup

    SVP_R_VL2_REQ -> SVP_R_VL2_ACK

Steps:

- Query `vnet_mac_ip` by [vid,mac] (limit 1)
- Query `portolan_underlay_mappings` by [cn_id] returned above (cached)


### VL3 lookup

   SVP_R_VL3_REQ -> SVP_R_VL3_ACK

Steps:

- Query `vnet_mac_ip` by [vid,ip] (limit 1)
- Query `portolan_underlay_mappings` by [cn_id] returned above (cached)


### Log event queries

   SVP_R_LOG_REQ -> SVP_R_LOG_ACK

Steps:

- Query `cn_net_events` by cn_id

Open questions:

- Should we have a seperate table per CN?


Both the `version` and `deleted` fields in the `vnet_mac_ip` table are
necessary to get around the case where the CN client is processing historical
records from the log and a lookup occurs.  This sequence of events:

1) VM is created: record gets added to `vnet_mac_ip` and
   `portolan_underlay_mappings` with version 1
2) CN agent on CN A goes down
3) VM is moved to a different CN: record gets added with version 2
4) CN agent on CN A comes up
5) Another VM requests the L2 mapping for that VM: portolan responds with the
   current record from `vnet_mac_ip`: version 2
6) CN agent on CN A requests log records: gets version 1, but disregards it
   because it already has version 2

The `deleted` flag serves a similar purpose, for where the VM gets deleted in
step 3.


### Bulk dump

    SVP_R_BULK_REQ -> SVP_R_BULK_ACK

Steps:

- Query `vnet_mac_ip` by [vid]
- Query `portolan_underlay_mappings` by [cn_id] as necessary (cached)

Each record contains both VL2 and VL3 mappings, so we can actually send two
ACKs per record.

### Nic actions

- Add a new record to `vnet_mac_ip`
- Query `vnet_mac_ip` to find other CNs on that vnet
- Add a log record to `cn_net_events` for each CN found in the above query

These are basically the same steps for all of the Nic and IP actions, though
obviously the "Add new record" step will be an update.

Open questions:

- Could log records be added using a moray trigger?
- If yes, can the trigger add
- Do we need another table that maps CN UUIDs to vnet IDs on that CN?

(These questions apply to all of the nic actions that update log records)
