
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_events": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"event_type": string,"id": string,"metadata": NonNullable<Json>,"organization_id": string,"request_id": string | null,"resource_id": string,"store_id": string | null
                  }
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"event_type": string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id": string,"request_id"?: string | null,"resource_id": string,"store_id"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"event_type"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id"?: string,"request_id"?: string | null,"resource_id"?: string,"store_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_events_organization_id_store_id_fkey"
      columns: ["organization_id","store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"displays": {
                  Row: {
                    "active": boolean,"active_pog_version_id": string | null,"created_at": string,"id": string,"name": string,"organization_id": string,"revision": number,"store_id": string,"updated_at": string
                  }
                  Insert: {
                    "active"?: boolean,"active_pog_version_id"?: string | null,"created_at"?: string,"id"?: string,"name": string,"organization_id": string,"revision"?: number,"store_id": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"active_pog_version_id"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"revision"?: number,"store_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "displays_organization_id_active_pog_version_id_fkey"
      columns: ["organization_id","active_pog_version_id"]
isOneToOne: false
      referencedRelation: "pog_versions"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "displays_organization_id_store_id_fkey"
      columns: ["organization_id","store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"idempotency_records": {
                  Row: {
                    "actor_id": string,"created_at": string,"expires_at": string,"id": string,"key": string,"request_hash": string,"resource_id": string | null,"response_body": Json | null,"response_status": number | null,"route_scope": string
                  }
                  Insert: {
                    "actor_id": string,"created_at"?: string,"expires_at"?: string,"id"?: string,"key": string,"request_hash": string,"resource_id"?: string | null,"response_body"?: Json | null,"response_status"?: number | null,"route_scope": string
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"key"?: string,"request_hash"?: string,"resource_id"?: string | null,"response_body"?: Json | null,"response_status"?: number | null,"route_scope"?: string
                  }
                  Relationships: [
                    
                  ]
                },"organization_memberships": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"organization_id": string,"revision": number,"role": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"organization_id": string,"revision"?: number,"role": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"organization_id"?: string,"revision"?: number,"role"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_memberships_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"name": string,"revision": number,"updated_at": string
                  }
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name": string,"revision"?: number,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name"?: string,"revision"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pog_slots": {
                  Row: {
                    "created_at": string,"height": number,"id": string,"label": string,"organization_id": string,"pog_version_id": string,"product_id": string,"refill_threshold": number | null,"revision": number,"sort_order": number,"target_quantity": number,"updated_at": string,"width": number,"x": number,"y": number
                  }
                  Insert: {
                    "created_at"?: string,"height": number,"id"?: string,"label": string,"organization_id": string,"pog_version_id": string,"product_id": string,"refill_threshold"?: number | null,"revision"?: number,"sort_order"?: number,"target_quantity": number,"updated_at"?: string,"width": number,"x": number,"y": number
                  }
                  Update: {
                    "created_at"?: string,"height"?: number,"id"?: string,"label"?: string,"organization_id"?: string,"pog_version_id"?: string,"product_id"?: string,"refill_threshold"?: number | null,"revision"?: number,"sort_order"?: number,"target_quantity"?: number,"updated_at"?: string,"width"?: number,"x"?: number,"y"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "pog_slots_organization_id_pog_version_id_fkey"
      columns: ["organization_id","pog_version_id"]
isOneToOne: false
      referencedRelation: "pog_versions"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "pog_slots_organization_id_product_id_fkey"
      columns: ["organization_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"pog_versions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"organization_id": string,"pog_id": string,"published_at": string | null,"published_by": string | null,"reference_height": number | null,"reference_path": string | null,"reference_upload_id": string | null,"reference_validated_at": string | null,"reference_width": number | null,"revision": number,"slots_need_review": boolean,"source_version_id": string | null,"state": string,"updated_at": string,"version_number": number
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"organization_id": string,"pog_id": string,"published_at"?: string | null,"published_by"?: string | null,"reference_height"?: number | null,"reference_path"?: string | null,"reference_upload_id"?: string | null,"reference_validated_at"?: string | null,"reference_width"?: number | null,"revision"?: number,"slots_need_review"?: boolean,"source_version_id"?: string | null,"state"?: string,"updated_at"?: string,"version_number": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"organization_id"?: string,"pog_id"?: string,"published_at"?: string | null,"published_by"?: string | null,"reference_height"?: number | null,"reference_path"?: string | null,"reference_upload_id"?: string | null,"reference_validated_at"?: string | null,"reference_width"?: number | null,"revision"?: number,"slots_need_review"?: boolean,"source_version_id"?: string | null,"state"?: string,"updated_at"?: string,"version_number"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "pog_versions_organization_id_pog_id_fkey"
      columns: ["organization_id","pog_id"]
isOneToOne: false
      referencedRelation: "pogs"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "pog_versions_reference_upload_id_fkey"
      columns: ["reference_upload_id"]
isOneToOne: false
      referencedRelation: "upload_intents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pog_versions_source_fkey"
      columns: ["organization_id","source_version_id"]
isOneToOne: false
      referencedRelation: "pog_versions"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"pogs": {
                  Row: {
                    "archived": boolean,"created_at": string,"id": string,"name": string,"organization_id": string,"revision": number,"updated_at": string
                  }
                  Insert: {
                    "archived"?: boolean,"created_at"?: string,"id"?: string,"name": string,"organization_id": string,"revision"?: number,"updated_at"?: string
                  }
                  Update: {
                    "archived"?: boolean,"created_at"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"revision"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pogs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "active": boolean,"category": string,"container_type": string,"created_at": string,"id": string,"name": string,"organization_id": string,"plu": string | null,"revision": number,"short_name": string,"sku": string | null,"upc": string | null,"updated_at": string
                  }
                  Insert: {
                    "active"?: boolean,"category": string,"container_type": string,"created_at"?: string,"id"?: string,"name": string,"organization_id": string,"plu"?: string | null,"revision"?: number,"short_name": string,"sku"?: string | null,"upc"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"category"?: string,"container_type"?: string,"created_at"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"plu"?: string | null,"revision"?: number,"short_name"?: string,"sku"?: string | null,"upc"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string,"revision": number,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"display_name"?: string,"revision"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"revision"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"scan_attempts": {
                  Row: {
                    "attempt_number": number,"created_at": string,"ended_at": string | null,"generation": number,"id": string,"input_height": number | null,"input_sha256": string | null,"input_width": number | null,"latency_ms": number | null,"model": string,"normalized_response": Json | null,"organization_id": string,"outcome": string,"prompt_version": string,"provider": string,"scan_id": string,"schema_version": number,"started_at": string,"usage_json": Json | null
                  }
                  Insert: {
                    "attempt_number": number,"created_at"?: string,"ended_at"?: string | null,"generation": number,"id"?: string,"input_height"?: number | null,"input_sha256"?: string | null,"input_width"?: number | null,"latency_ms"?: number | null,"model": string,"normalized_response"?: Json | null,"organization_id": string,"outcome": string,"prompt_version": string,"provider": string,"scan_id": string,"schema_version": number,"started_at": string,"usage_json"?: Json | null
                  }
                  Update: {
                    "attempt_number"?: number,"created_at"?: string,"ended_at"?: string | null,"generation"?: number,"id"?: string,"input_height"?: number | null,"input_sha256"?: string | null,"input_width"?: number | null,"latency_ms"?: number | null,"model"?: string,"normalized_response"?: Json | null,"organization_id"?: string,"outcome"?: string,"prompt_version"?: string,"provider"?: string,"scan_id"?: string,"schema_version"?: number,"started_at"?: string,"usage_json"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_attempts_organization_id_scan_id_fkey"
      columns: ["organization_id","scan_id"]
isOneToOne: false
      referencedRelation: "scans"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"scan_confirmations": {
                  Row: {
                    "confirmed_at": string,"confirmed_by": string,"created_at": string,"display_score": number | null,"id": string,"organization_id": string,"scan_id": string,"scan_revision": number,"total_refill": number
                  }
                  Insert: {
                    "confirmed_at"?: string,"confirmed_by": string,"created_at"?: string,"display_score"?: number | null,"id"?: string,"organization_id": string,"scan_id": string,"scan_revision": number,"total_refill": number
                  }
                  Update: {
                    "confirmed_at"?: string,"confirmed_by"?: string,"created_at"?: string,"display_score"?: number | null,"id"?: string,"organization_id"?: string,"scan_id"?: string,"scan_revision"?: number,"total_refill"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_confirmations_organization_id_scan_id_fkey"
      columns: ["organization_id","scan_id"]
isOneToOne: false
      referencedRelation: "scans"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"scan_corrections": {
                  Row: {
                    "actor_id": string,"corrected_quantity": number,"created_at": string,"id": string,"organization_id": string,"original_ai_quantity": number | null,"previous_quantity": number | null,"reason": string | null,"scan_id": string,"scan_revision": number,"scan_slot_id": string
                  }
                  Insert: {
                    "actor_id": string,"corrected_quantity": number,"created_at"?: string,"id"?: string,"organization_id": string,"original_ai_quantity"?: number | null,"previous_quantity"?: number | null,"reason"?: string | null,"scan_id": string,"scan_revision": number,"scan_slot_id": string
                  }
                  Update: {
                    "actor_id"?: string,"corrected_quantity"?: number,"created_at"?: string,"id"?: string,"organization_id"?: string,"original_ai_quantity"?: number | null,"previous_quantity"?: number | null,"reason"?: string | null,"scan_id"?: string,"scan_revision"?: number,"scan_slot_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_corrections_organization_id_scan_id_fkey"
      columns: ["organization_id","scan_id"]
isOneToOne: false
      referencedRelation: "scans"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "scan_corrections_scan_id_scan_slot_id_fkey"
      columns: ["scan_id","scan_slot_id"]
isOneToOne: false
      referencedRelation: "scan_slots"
      referencedColumns: ["scan_id","id"]
    }
                  ]
                },"scan_jobs": {
                  Row: {
                    "attempt_count": number,"available_at": string,"created_at": string,"generation": number,"id": string,"last_error_code": string | null,"lease_token": string | null,"lease_until": string | null,"organization_id": string,"revision": number,"scan_id": string,"state": string,"updated_at": string
                  }
                  Insert: {
                    "attempt_count"?: number,"available_at"?: string,"created_at"?: string,"generation": number,"id"?: string,"last_error_code"?: string | null,"lease_token"?: string | null,"lease_until"?: string | null,"organization_id": string,"revision"?: number,"scan_id": string,"state"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempt_count"?: number,"available_at"?: string,"created_at"?: string,"generation"?: number,"id"?: string,"last_error_code"?: string | null,"lease_token"?: string | null,"lease_until"?: string | null,"organization_id"?: string,"revision"?: number,"scan_id"?: string,"state"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_jobs_organization_id_scan_id_fkey"
      columns: ["organization_id","scan_id"]
isOneToOne: false
      referencedRelation: "scans"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"scan_slots": {
                  Row: {
                    "accepted_quantity": number | null,"ai_confidence": number | null,"ai_flags": (string)[],"ai_quantity": number | null,"created_at": string,"final_quantity": number | null,"id": string,"organization_id": string,"pog_slot_id": string,"pog_version_id": string,"product_id": string,"product_name_snapshot": string,"refill_quantity": number | null,"review_required": boolean,"review_state": string,"scan_id": string,"slot_label_snapshot": string,"target_snapshot": number,"threshold_snapshot": number | null,"updated_at": string
                  }
                  Insert: {
                    "accepted_quantity"?: number | null,"ai_confidence"?: number | null,"ai_flags"?: (string)[],"ai_quantity"?: number | null,"created_at"?: string,"final_quantity"?: number | null,"id"?: string,"organization_id": string,"pog_slot_id": string,"pog_version_id": string,"product_id": string,"product_name_snapshot": string,"refill_quantity"?: number | null,"review_required"?: boolean,"review_state"?: string,"scan_id": string,"slot_label_snapshot": string,"target_snapshot": number,"threshold_snapshot"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "accepted_quantity"?: number | null,"ai_confidence"?: number | null,"ai_flags"?: (string)[],"ai_quantity"?: number | null,"created_at"?: string,"final_quantity"?: number | null,"id"?: string,"organization_id"?: string,"pog_slot_id"?: string,"pog_version_id"?: string,"product_id"?: string,"product_name_snapshot"?: string,"refill_quantity"?: number | null,"review_required"?: boolean,"review_state"?: string,"scan_id"?: string,"slot_label_snapshot"?: string,"target_snapshot"?: number,"threshold_snapshot"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_slots_organization_id_product_id_fkey"
      columns: ["organization_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "scan_slots_organization_id_scan_id_pog_version_id_fkey"
      columns: ["organization_id","scan_id","pog_version_id"]
isOneToOne: false
      referencedRelation: "scans"
      referencedColumns: ["organization_id","id","pog_version_id"]
    },{
      foreignKeyName: "scan_slots_pog_version_id_pog_slot_id_fkey"
      columns: ["pog_version_id","pog_slot_id"]
isOneToOne: false
      referencedRelation: "pog_slots"
      referencedColumns: ["pog_version_id","id"]
    }
                  ]
                },"scans": {
                  Row: {
                    "captured_at": string | null,"completed_at": string | null,"completed_by": string | null,"confirmed_at": string | null,"created_at": string,"created_by": string,"crop_json": Json | null,"display_id": string,"display_score": number | null,"id": string,"image_deleted_at": string | null,"image_path": string | null,"job_generation": number,"organization_id": string,"pog_version_id": string,"retry_generation_count": number,"revision": number,"source": string,"status": string,"store_id": string,"total_refill": number | null,"updated_at": string
                  }
                  Insert: {
                    "captured_at"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null,"confirmed_at"?: string | null,"created_at"?: string,"created_by": string,"crop_json"?: Json | null,"display_id": string,"display_score"?: number | null,"id"?: string,"image_deleted_at"?: string | null,"image_path"?: string | null,"job_generation"?: number,"organization_id": string,"pog_version_id": string,"retry_generation_count"?: number,"revision"?: number,"source": string,"status": string,"store_id": string,"total_refill"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "captured_at"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string,"crop_json"?: Json | null,"display_id"?: string,"display_score"?: number | null,"id"?: string,"image_deleted_at"?: string | null,"image_path"?: string | null,"job_generation"?: number,"organization_id"?: string,"pog_version_id"?: string,"retry_generation_count"?: number,"revision"?: number,"source"?: string,"status"?: string,"store_id"?: string,"total_refill"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scans_organization_id_pog_version_id_fkey"
      columns: ["organization_id","pog_version_id"]
isOneToOne: false
      referencedRelation: "pog_versions"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "scans_organization_id_store_id_display_id_fkey"
      columns: ["organization_id","store_id","display_id"]
isOneToOne: false
      referencedRelation: "displays"
      referencedColumns: ["organization_id","store_id","id"]
    },{
      foreignKeyName: "scans_organization_id_store_id_fkey"
      columns: ["organization_id","store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"store_memberships": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"organization_id": string,"revision": number,"role": string,"store_id": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"organization_id": string,"revision"?: number,"role": string,"store_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"organization_id"?: string,"revision"?: number,"role"?: string,"store_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "store_memberships_organization_id_store_id_fkey"
      columns: ["organization_id","store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "store_memberships_organization_id_user_id_fkey"
      columns: ["organization_id","user_id"]
isOneToOne: false
      referencedRelation: "organization_memberships"
      referencedColumns: ["organization_id","user_id"]
    }
                  ]
                },"stores": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"name": string,"organization_id": string,"revision": number,"store_number": string,"timezone": string,"updated_at": string
                  }
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name": string,"organization_id": string,"revision"?: number,"store_number": string,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"revision"?: number,"store_number"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stores_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"upload_intents": {
                  Row: {
                    "actor_id": string,"bucket": string,"created_at": string,"expected_type": string,"expires_at": string,"id": string,"max_bytes": number,"object_path": string,"organization_id": string,"resource_id": string,"revision": number,"state": string,"store_id": string | null,"updated_at": string
                  }
                  Insert: {
                    "actor_id": string,"bucket": string,"created_at"?: string,"expected_type": string,"expires_at": string,"id"?: string,"max_bytes": number,"object_path": string,"organization_id": string,"resource_id": string,"revision"?: number,"state"?: string,"store_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "actor_id"?: string,"bucket"?: string,"created_at"?: string,"expected_type"?: string,"expires_at"?: string,"id"?: string,"max_bytes"?: number,"object_path"?: string,"organization_id"?: string,"resource_id"?: string,"revision"?: number,"state"?: string,"store_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "upload_intents_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "upload_intents_organization_id_store_id_fkey"
      columns: ["organization_id","store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "apply_membership_invite":
{ Args: { "p_actor": string,"p_org": string,"p_org_role": string,"p_request_id"?: string,"p_stores": Json,"p_user": string }; Returns: number
                           },
"bootstrap_first_admin":
{ Args: { "p_org"?: string,"p_org_name"?: string,"p_user": string }; Returns: string
                           },
"create_display":
{ Args: { "p_active_pog_version_id"?: string,"p_actor": string,"p_name": string,"p_request_id"?: string,"p_store_id": string }; Returns: {
              "active": boolean,
"active_pog_version_id": string | null,
"created_at": string,
"id": string,
"name": string,
"organization_id": string,
"revision": number,
"store_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "displays"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_pog":
{ Args: { "p_actor": string,"p_name": string,"p_org": string,"p_request_id"?: string }; Returns: {
              "archived": boolean,
"created_at": string,
"id": string,
"name": string,
"organization_id": string,
"revision": number,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "pogs"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_pog_upload_intent":
{ Args: { "p_actor": string,"p_request_id"?: string,"p_version_id": string }; Returns: {
              "actor_id": string,
"bucket": string,
"created_at": string,
"expected_type": string,
"expires_at": string,
"id": string,
"max_bytes": number,
"object_path": string,
"organization_id": string,
"resource_id": string,
"revision": number,
"state": string,
"store_id": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "upload_intents"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_pog_version":
{ Args: { "p_actor": string,"p_pog_id": string,"p_request_id"?: string,"p_source_version_id"?: string }; Returns: {
              "created_at": string,
"created_by": string | null,
"id": string,
"organization_id": string,
"pog_id": string,
"published_at": string | null,
"published_by": string | null,
"reference_height": number | null,
"reference_path": string | null,
"reference_upload_id": string | null,
"reference_validated_at": string | null,
"reference_width": number | null,
"revision": number,
"slots_need_review": boolean,
"source_version_id": string | null,
"state": string,
"updated_at": string,
"version_number": number
            }
                          SetofOptions: {
        from: "*"
        to: "pog_versions"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_product":
{ Args: { "p_actor": string,"p_category": string,"p_container_type": string,"p_name": string,"p_org": string,"p_plu"?: string,"p_request_id"?: string,"p_short_name": string,"p_sku"?: string,"p_upc"?: string }; Returns: {
              "active": boolean,
"category": string,
"container_type": string,
"created_at": string,
"id": string,
"name": string,
"organization_id": string,
"plu": string | null,
"revision": number,
"short_name": string,
"sku": string | null,
"upc": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "products"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_scan":
{ Args: { "p_actor": string,"p_display_id": string,"p_expected_pog_version_id"?: string,"p_source": string }; Returns: {
              "pog_version_id": string,"revision": number,"scan_id": string,"slot_count": number,"status": string,"upload_bucket": string,"upload_expires_at": string,"upload_object_path": string
            }[]
                           },
"create_store":
{ Args: { "p_actor": string,"p_name": string,"p_org": string,"p_request_id"?: string,"p_store_number": string,"p_timezone": string }; Returns: {
              "active": boolean,
"created_at": string,
"id": string,
"name": string,
"organization_id": string,
"revision": number,
"store_number": string,
"timezone": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "stores"
        isOneToOne: true
        isSetofReturn: false
      } },
"finalize_pog_reference":
{ Args: { "p_actor": string,"p_expected_revision": number,"p_height": number,"p_request_id"?: string,"p_sha256": string,"p_upload_id": string,"p_version_id": string,"p_width": number }; Returns: {
              "created_at": string,
"created_by": string | null,
"id": string,
"organization_id": string,
"pog_id": string,
"published_at": string | null,
"published_by": string | null,
"reference_height": number | null,
"reference_path": string | null,
"reference_upload_id": string | null,
"reference_validated_at": string | null,
"reference_width": number | null,
"revision": number,
"slots_need_review": boolean,
"source_version_id": string | null,
"state": string,
"updated_at": string,
"version_number": number
            }
                          SetofOptions: {
        from: "*"
        to: "pog_versions"
        isOneToOne: true
        isSetofReturn: false
      } },
"list_organization_members":
{ Args: { "p_actor": string,"p_org": string }; Returns: {
              "active": boolean,"display_name": string,"email": string,"invited_at": string,"last_sign_in_at": string,"org_role": string,"revision": number,"stores": Json,"user_id": string
            }[]
                           },
"publish_pog_version":
{ Args: { "p_actor": string,"p_expected_revision": number,"p_request_id"?: string,"p_version_id": string }; Returns: {
              "created_at": string,
"created_by": string | null,
"id": string,
"organization_id": string,
"pog_id": string,
"published_at": string | null,
"published_by": string | null,
"reference_height": number | null,
"reference_path": string | null,
"reference_upload_id": string | null,
"reference_validated_at": string | null,
"reference_width": number | null,
"revision": number,
"slots_need_review": boolean,
"source_version_id": string | null,
"state": string,
"updated_at": string,
"version_number": number
            }
                          SetofOptions: {
        from: "*"
        to: "pog_versions"
        isOneToOne: true
        isSetofReturn: false
      } },
"replace_pog_slots":
{ Args: { "p_actor": string,"p_confirm_coordinates"?: boolean,"p_expected_revision": number,"p_request_id"?: string,"p_slots": Json,"p_version_id": string }; Returns: {
              "created_at": string,
"created_by": string | null,
"id": string,
"organization_id": string,
"pog_id": string,
"published_at": string | null,
"published_by": string | null,
"reference_height": number | null,
"reference_path": string | null,
"reference_upload_id": string | null,
"reference_validated_at": string | null,
"reference_width": number | null,
"revision": number,
"slots_need_review": boolean,
"source_version_id": string | null,
"state": string,
"updated_at": string,
"version_number": number
            }
                          SetofOptions: {
        from: "*"
        to: "pog_versions"
        isOneToOne: true
        isSetofReturn: false
      } },
"settle_pog_upload":
{ Args: { "p_actor": string,"p_state": string,"p_upload_id": string }; Returns: {
              "actor_id": string,
"bucket": string,
"created_at": string,
"expected_type": string,
"expires_at": string,
"id": string,
"max_bytes": number,
"object_path": string,
"organization_id": string,
"resource_id": string,
"revision": number,
"state": string,
"store_id": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "upload_intents"
        isOneToOne: true
        isSetofReturn: false
      } },
"update_display":
{ Args: { "p_actor": string,"p_changes": Json,"p_display_id": string,"p_expected_revision": number,"p_request_id"?: string }; Returns: {
              "active": boolean,
"active_pog_version_id": string | null,
"created_at": string,
"id": string,
"name": string,
"organization_id": string,
"revision": number,
"store_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "displays"
        isOneToOne: true
        isSetofReturn: false
      } },
"update_membership":
{ Args: { "p_active"?: boolean,"p_actor": string,"p_expected_revision": number,"p_org": string,"p_org_role"?: string,"p_request_id"?: string,"p_stores"?: Json,"p_user": string }; Returns: number
                           },
"update_pog":
{ Args: { "p_actor": string,"p_changes": Json,"p_expected_revision": number,"p_pog_id": string,"p_request_id"?: string }; Returns: {
              "archived": boolean,
"created_at": string,
"id": string,
"name": string,
"organization_id": string,
"revision": number,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "pogs"
        isOneToOne: true
        isSetofReturn: false
      } },
"update_product":
{ Args: { "p_actor": string,"p_changes": Json,"p_expected_revision": number,"p_product_id": string,"p_request_id"?: string }; Returns: {
              "active": boolean,
"category": string,
"container_type": string,
"created_at": string,
"id": string,
"name": string,
"organization_id": string,
"plu": string | null,
"revision": number,
"short_name": string,
"sku": string | null,
"upc": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "products"
        isOneToOne: true
        isSetofReturn: false
      } },
"update_store":
{ Args: { "p_actor": string,"p_changes": Json,"p_expected_revision": number,"p_request_id"?: string,"p_store_id": string }; Returns: {
              "active": boolean,
"created_at": string,
"id": string,
"name": string,
"organization_id": string,
"revision": number,
"store_number": string,
"timezone": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "stores"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
