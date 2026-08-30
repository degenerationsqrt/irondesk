export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      body_metrics: {
        Row: {
          body_fat_percent: number | null
          created_at: string
          id: string
          is_sample: boolean
          note: string | null
          recorded_at: string
          updated_at: string
          user_id: string
          waist_cm: number | null
          weight_kg: number | null
        }
        Insert: {
          body_fat_percent?: number | null
          created_at?: string
          id?: string
          is_sample?: boolean
          note?: string | null
          recorded_at?: string
          updated_at?: string
          user_id: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Update: {
          body_fat_percent?: number | null
          created_at?: string
          id?: string
          is_sample?: boolean
          note?: string | null
          recorded_at?: string
          updated_at?: string
          user_id?: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      cardio_sessions: {
        Row: {
          active_zone_minutes: number | null
          avg_hr: number | null
          calories: number | null
          cardio_load: number | null
          created_at: string
          distance_km: number | null
          duration_min: number
          id: string
          is_sample: boolean
          max_hr: number | null
          name: string
          notes: string | null
          session_id: string | null
          started_at: string
          updated_at: string
          user_id: string
          zones: Json
        }
        Insert: {
          active_zone_minutes?: number | null
          avg_hr?: number | null
          calories?: number | null
          cardio_load?: number | null
          created_at?: string
          distance_km?: number | null
          duration_min?: number
          id?: string
          is_sample?: boolean
          max_hr?: number | null
          name?: string
          notes?: string | null
          session_id?: string | null
          started_at?: string
          updated_at?: string
          user_id: string
          zones?: Json
        }
        Update: {
          active_zone_minutes?: number | null
          avg_hr?: number | null
          calories?: number | null
          cardio_load?: number | null
          created_at?: string
          distance_km?: number | null
          duration_min?: number
          id?: string
          is_sample?: boolean
          max_hr?: number | null
          name?: string
          notes?: string | null
          session_id?: string | null
          started_at?: string
          updated_at?: string
          user_id?: string
          zones?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cardio_sessions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          created_at: string
          id: string
          label: string
          last_import_at: string | null
          metadata: Json
          retain_original_files: boolean
          source_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          last_import_at?: string | null
          metadata?: Json
          retain_original_files?: boolean
          source_type: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_import_at?: string | null
          metadata?: Json
          retain_original_files?: boolean
          source_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      connect_iq_event_receipts: {
        Row: {
          created_at: string
          device_id: string
          event_id: string
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          request_hash: string
          response: Json
          session_id: string
          set_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          event_id: string
          event_type: string
          id?: string
          occurred_at: string
          payload?: Json
          request_hash: string
          response?: Json
          session_id: string
          set_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          event_id?: string
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          request_hash?: string
          response?: Json
          session_id?: string
          set_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_iq_event_receipts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_iq_event_receipts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_iq_event_receipts_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "workout_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      device_links: {
        Row: {
          created_at: string
          data_source_id: string | null
          id: string
          label: string
          last_sync_at: string | null
          last_sync_summary: Json
          platform: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data_source_id?: string | null
          id?: string
          label: string
          last_sync_at?: string | null
          last_sync_summary?: Json
          platform?: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          data_source_id?: string | null
          id?: string
          label?: string
          last_sync_at?: string | null
          last_sync_summary?: Json
          platform?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_links_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      device_pairings: {
        Row: {
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          label: string
          platform: string
          user_id: string
        }
        Insert: {
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          label?: string
          platform?: string
          user_id: string
        }
        Update: {
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          label?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      equipment_catalog: {
        Row: {
          category: string
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      exercise_favorites: {
        Row: {
          created_at: string
          exercise_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_favorites_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          created_at: string
          cues: string[]
          equipment: string
          id: string
          instructions: string | null
          is_active: boolean
          movement_pattern: string
          name: string
          owner_id: string | null
          primary_muscle: string
          secondary_muscles: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          cues?: string[]
          equipment?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          movement_pattern?: string
          name: string
          owner_id?: string | null
          primary_muscle: string
          secondary_muscles?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          cues?: string[]
          equipment?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          movement_pattern?: string
          name?: string
          owner_id?: string | null
          primary_muscle?: string
          secondary_muscles?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      health_metrics: {
        Row: {
          created_at: string
          dedupe_hash: string
          external_id: string | null
          id: string
          import_job_id: string | null
          imported_at: string
          metric_type: string
          normalized_version: number
          notes: string | null
          raw_metadata: Json
          recorded_at: string
          source_file_name: string | null
          source_timezone: string | null
          source_type: string
          unit: string
          updated_at: string
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          dedupe_hash: string
          external_id?: string | null
          id?: string
          import_job_id?: string | null
          imported_at?: string
          metric_type: string
          normalized_version?: number
          notes?: string | null
          raw_metadata?: Json
          recorded_at: string
          source_file_name?: string | null
          source_timezone?: string | null
          source_type: string
          unit: string
          updated_at?: string
          user_id: string
          value: number
        }
        Update: {
          created_at?: string
          dedupe_hash?: string
          external_id?: string | null
          id?: string
          import_job_id?: string | null
          imported_at?: string
          metric_type?: string
          normalized_version?: number
          notes?: string | null
          raw_metadata?: Json
          recorded_at?: string
          source_file_name?: string | null
          source_timezone?: string | null
          source_type?: string
          unit?: string
          updated_at?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "health_metrics_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          created_at: string
          data_source_id: string | null
          duplicate_count: number
          error_message: string | null
          failed_count: number
          file_format: string
          file_name: string | null
          file_size_bytes: number | null
          finished_at: string | null
          id: string
          imported_count: number
          normalized_version: number
          source_type: string
          started_at: string
          status: string
          storage_path: string | null
          total_records: number
          updated_at: string
          user_id: string
          warning_count: number
          warnings: Json
        }
        Insert: {
          created_at?: string
          data_source_id?: string | null
          duplicate_count?: number
          error_message?: string | null
          failed_count?: number
          file_format: string
          file_name?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          id?: string
          imported_count?: number
          normalized_version?: number
          source_type: string
          started_at?: string
          status?: string
          storage_path?: string | null
          total_records?: number
          updated_at?: string
          user_id: string
          warning_count?: number
          warnings?: Json
        }
        Update: {
          created_at?: string
          data_source_id?: string | null
          duplicate_count?: number
          error_message?: string | null
          failed_count?: number
          file_format?: string
          file_name?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          id?: string
          imported_count?: number
          normalized_version?: number
          source_type?: string
          started_at?: string
          status?: string
          storage_path?: string | null
          total_records?: number
          updated_at?: string
          user_id?: string
          warning_count?: number
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      imported_activities: {
        Row: {
          activity_type: string
          avg_hr: number | null
          calories: number | null
          created_at: string
          dedupe_hash: string
          distance_m: number | null
          duration_sec: number | null
          elevation_gain_m: number | null
          external_id: string | null
          id: string
          import_job_id: string | null
          imported_at: string
          max_hr: number | null
          name: string | null
          normalized_version: number
          notes: string | null
          raw_metadata: Json
          source_file_name: string | null
          source_timezone: string | null
          source_type: string
          started_at: string
          steps: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_type: string
          avg_hr?: number | null
          calories?: number | null
          created_at?: string
          dedupe_hash: string
          distance_m?: number | null
          duration_sec?: number | null
          elevation_gain_m?: number | null
          external_id?: string | null
          id?: string
          import_job_id?: string | null
          imported_at?: string
          max_hr?: number | null
          name?: string | null
          normalized_version?: number
          notes?: string | null
          raw_metadata?: Json
          source_file_name?: string | null
          source_timezone?: string | null
          source_type: string
          started_at: string
          steps?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_type?: string
          avg_hr?: number | null
          calories?: number | null
          created_at?: string
          dedupe_hash?: string
          distance_m?: number | null
          duration_sec?: number | null
          elevation_gain_m?: number | null
          external_id?: string | null
          id?: string
          import_job_id?: string | null
          imported_at?: string
          max_hr?: number | null
          name?: string | null
          normalized_version?: number
          notes?: string | null
          raw_metadata?: Json
          source_file_name?: string | null
          source_timezone?: string | null
          source_type?: string
          started_at?: string
          steps?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_activities_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      meals: {
        Row: {
          calories: number
          carbs_g: number
          created_at: string
          eaten_at: string | null
          eaten_at_label: string | null
          fat_g: number
          id: string
          items: Json
          name: string
          nutrition_day_id: string
          protein_g: number
          updated_at: string
        }
        Insert: {
          calories?: number
          carbs_g?: number
          created_at?: string
          eaten_at?: string | null
          eaten_at_label?: string | null
          fat_g?: number
          id?: string
          items?: Json
          name: string
          nutrition_day_id: string
          protein_g?: number
          updated_at?: string
        }
        Update: {
          calories?: number
          carbs_g?: number
          created_at?: string
          eaten_at?: string | null
          eaten_at_label?: string | null
          fat_g?: number
          id?: string
          items?: Json
          name?: string
          nutrition_day_id?: string
          protein_g?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meals_nutrition_day_id_fkey"
            columns: ["nutrition_day_id"]
            isOneToOne: false
            referencedRelation: "nutrition_days"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_days: {
        Row: {
          calorie_target: number | null
          calories: number
          carb_target_g: number | null
          carbs_g: number
          created_at: string
          day: string
          fat_g: number
          fat_target_g: number | null
          hydration_ml: number
          hydration_target_ml: number
          id: string
          is_sample: boolean
          protein_g: number
          protein_target_g: number | null
          updated_at: string
          user_id: string
          weight_goal_direction: string
          weight_goal_rate_kg_per_week: number
        }
        Insert: {
          calorie_target?: number | null
          calories?: number
          carb_target_g?: number | null
          carbs_g?: number
          created_at?: string
          day?: string
          fat_g?: number
          fat_target_g?: number | null
          hydration_ml?: number
          hydration_target_ml?: number
          id?: string
          is_sample?: boolean
          protein_g?: number
          protein_target_g?: number | null
          updated_at?: string
          user_id: string
          weight_goal_direction?: string
          weight_goal_rate_kg_per_week?: number
        }
        Update: {
          calorie_target?: number | null
          calories?: number
          carb_target_g?: number | null
          carbs_g?: number
          created_at?: string
          day?: string
          fat_g?: number
          fat_target_g?: number | null
          hydration_ml?: number
          hydration_target_ml?: number
          id?: string
          is_sample?: boolean
          protein_g?: number
          protein_target_g?: number | null
          updated_at?: string
          user_id?: string
          weight_goal_direction?: string
          weight_goal_rate_kg_per_week?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          current_weight_kg: number | null
          date_of_birth: string | null
          display_name: string
          height_cm: number | null
          id: string
          onboarding_completed: boolean
          onboarding_step: number
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          current_weight_kg?: number | null
          date_of_birth?: string | null
          display_name?: string
          height_cm?: number | null
          id: string
          onboarding_completed?: boolean
          onboarding_step?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          current_weight_kg?: number | null
          date_of_birth?: string | null
          display_name?: string
          height_cm?: number | null
          id?: string
          onboarding_completed?: boolean
          onboarding_step?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      program_enrollments: {
        Row: {
          acknowledged_at: string | null
          acknowledged_gate: string | null
          assigned_by: string | null
          completed_at: string | null
          created_at: string
          current_cycle: number
          current_position: number
          current_week: number
          id: string
          paused_at: string | null
          program_id: string
          settings: Json
          started_on: string
          status: string
          training_days: number[]
          updated_at: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_gate?: string | null
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string
          current_cycle?: number
          current_position?: number
          current_week?: number
          id?: string
          paused_at?: string | null
          program_id: string
          settings?: Json
          started_on?: string
          status?: string
          training_days?: number[]
          updated_at?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_gate?: string | null
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string
          current_cycle?: number
          current_position?: number
          current_week?: number
          id?: string
          paused_at?: string | null
          program_id?: string
          settings?: Json
          started_on?: string
          status?: string
          training_days?: number[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_enrollments_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_workouts: {
        Row: {
          created_at: string
          day_index: number | null
          day_of_week: number | null
          id: string
          label: string | null
          metadata: Json
          notes: string | null
          position: number
          program_id: string
          source_slot_key: string | null
          template_id: string
          template_version: number
          updated_at: string
          week_index: number | null
        }
        Insert: {
          created_at?: string
          day_index?: number | null
          day_of_week?: number | null
          id?: string
          label?: string | null
          metadata?: Json
          notes?: string | null
          position: number
          program_id: string
          source_slot_key?: string | null
          template_id: string
          template_version?: number
          updated_at?: string
          week_index?: number | null
        }
        Update: {
          created_at?: string
          day_index?: number | null
          day_of_week?: number | null
          id?: string
          label?: string | null
          metadata?: Json
          notes?: string | null
          position?: number
          program_id?: string
          source_slot_key?: string | null
          template_id?: string
          template_version?: number
          updated_at?: string
          week_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "program_workouts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_workouts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workout_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          created_at: string
          cycle_length_weeks: number | null
          days_per_week: number | null
          description: string | null
          environment: string | null
          id: string
          is_active: boolean
          is_system: boolean
          level: string | null
          name: string
          owner_id: string | null
          release_gate: string
          schedule_mode: string
          sort_order: number
          source_key: string | null
          source_notes: Json
          source_version: number
          tags: string[]
          updated_at: string
          warnings: Json
        }
        Insert: {
          created_at?: string
          cycle_length_weeks?: number | null
          days_per_week?: number | null
          description?: string | null
          environment?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          level?: string | null
          name: string
          owner_id?: string | null
          release_gate?: string
          schedule_mode?: string
          sort_order?: number
          source_key?: string | null
          source_notes?: Json
          source_version?: number
          tags?: string[]
          updated_at?: string
          warnings?: Json
        }
        Update: {
          created_at?: string
          cycle_length_weeks?: number | null
          days_per_week?: number | null
          description?: string | null
          environment?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          level?: string | null
          name?: string
          owner_id?: string | null
          release_gate?: string
          schedule_mode?: string
          sort_order?: number
          source_key?: string | null
          source_notes?: Json
          source_version?: number
          tags?: string[]
          updated_at?: string
          warnings?: Json
        }
        Relationships: []
      }
      recovery_entries: {
        Row: {
          created_at: string
          day: string
          fatigue: number | null
          hrv_ms: number | null
          id: string
          is_sample: boolean
          note: string | null
          readiness: number | null
          resting_hr: number | null
          sleep_efficiency_percent: number | null
          sleep_hours: number | null
          soreness: Json
          source: string
          stress: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day?: string
          fatigue?: number | null
          hrv_ms?: number | null
          id?: string
          is_sample?: boolean
          note?: string | null
          readiness?: number | null
          resting_hr?: number | null
          sleep_efficiency_percent?: number | null
          sleep_hours?: number | null
          soreness?: Json
          source?: string
          stress?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day?: string
          fatigue?: number | null
          hrv_ms?: number | null
          id?: string
          is_sample?: boolean
          note?: string | null
          readiness?: number | null
          resting_hr?: number | null
          sleep_efficiency_percent?: number | null
          sleep_hours?: number | null
          soreness?: Json
          source?: string
          stress?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_import_mappings: {
        Row: {
          created_at: string
          file_format: string
          id: string
          mapping: Json
          record_kind: string
          source_label: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_format: string
          id?: string
          mapping: Json
          record_kind: string
          source_label: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_format?: string
          id?: string
          mapping?: Json
          record_kind?: string
          source_label?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scheduled_workouts: {
        Row: {
          adjustment: Json
          completed_at: string | null
          created_at: string
          enrollment_id: string
          id: string
          program_workout_id: string
          scheduled_for: string | null
          sequence_index: number
          session_id: string | null
          skipped_at: string | null
          status: string
          template_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          adjustment?: Json
          completed_at?: string | null
          created_at?: string
          enrollment_id: string
          id?: string
          program_workout_id: string
          scheduled_for?: string | null
          sequence_index: number
          session_id?: string | null
          skipped_at?: string | null
          status?: string
          template_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          adjustment?: Json
          completed_at?: string | null
          created_at?: string
          enrollment_id?: string
          id?: string
          program_workout_id?: string
          scheduled_for?: string | null
          sequence_index?: number
          session_id?: string | null
          skipped_at?: string | null
          status?: string
          template_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_workouts_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "program_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_workouts_program_workout_id_fkey"
            columns: ["program_workout_id"]
            isOneToOne: false
            referencedRelation: "program_workouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_workouts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "workout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_workouts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workout_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      session_exercises: {
        Row: {
          created_at: string
          equipment: string | null
          exercise_id: string | null
          exercise_name: string
          id: string
          is_drop_set: boolean
          is_heavy: boolean
          load_guidance: string | null
          notes: string | null
          original_exercise_id: string | null
          position: number
          primary_muscle: string | null
          rest_seconds: number | null
          session_id: string
          source_load_unit: string | null
          target_reps: string | null
          target_rpe: number | null
          target_sets: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          equipment?: string | null
          exercise_id?: string | null
          exercise_name: string
          id?: string
          is_drop_set?: boolean
          is_heavy?: boolean
          load_guidance?: string | null
          notes?: string | null
          original_exercise_id?: string | null
          position?: number
          primary_muscle?: string | null
          rest_seconds?: number | null
          session_id: string
          source_load_unit?: string | null
          target_reps?: string | null
          target_rpe?: number | null
          target_sets?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          equipment?: string | null
          exercise_id?: string | null
          exercise_name?: string
          id?: string
          is_drop_set?: boolean
          is_heavy?: boolean
          load_guidance?: string | null
          notes?: string | null
          original_exercise_id?: string | null
          position?: number
          primary_muscle?: string | null
          rest_seconds?: number | null
          session_id?: string
          source_load_unit?: string | null
          target_reps?: string | null
          target_rpe?: number | null
          target_sets?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_exercises_original_exercise_id_fkey"
            columns: ["original_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_exercises_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      template_exercises: {
        Row: {
          created_at: string
          exercise_id: string | null
          exercise_name: string
          id: string
          is_drop_set: boolean
          is_heavy: boolean
          load_guidance: string | null
          notes: string | null
          position: number
          rest_seconds: number | null
          source_load_unit: string | null
          target_reps: string | null
          target_rpe: number | null
          target_sets: number | null
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          exercise_id?: string | null
          exercise_name: string
          id?: string
          is_drop_set?: boolean
          is_heavy?: boolean
          load_guidance?: string | null
          notes?: string | null
          position?: number
          rest_seconds?: number | null
          source_load_unit?: string | null
          target_reps?: string | null
          target_rpe?: number | null
          target_sets?: number | null
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          exercise_id?: string | null
          exercise_name?: string
          id?: string
          is_drop_set?: boolean
          is_heavy?: boolean
          load_guidance?: string | null
          notes?: string | null
          position?: number
          rest_seconds?: number | null
          source_load_unit?: string | null
          target_reps?: string | null
          target_rpe?: number | null
          target_sets?: number | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_exercises_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workout_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      user_equipment: {
        Row: {
          created_at: string
          equipment_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          equipment_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          equipment_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          calorie_target: number | null
          created_at: string
          notify_pr_alerts: boolean
          notify_weekly_summary: boolean
          notify_workout_reminders: boolean
          primary_goal: string
          protein_target_g: number | null
          public_profile: boolean
          share_anonymous_analytics: boolean
          training_days_per_week: number
          units: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calorie_target?: number | null
          created_at?: string
          notify_pr_alerts?: boolean
          notify_weekly_summary?: boolean
          notify_workout_reminders?: boolean
          primary_goal?: string
          protein_target_g?: number | null
          public_profile?: boolean
          share_anonymous_analytics?: boolean
          training_days_per_week?: number
          units?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calorie_target?: number | null
          created_at?: string
          notify_pr_alerts?: boolean
          notify_weekly_summary?: boolean
          notify_workout_reminders?: boolean
          primary_goal?: string
          protein_target_g?: number | null
          public_profile?: boolean
          share_anonymous_analytics?: boolean
          training_days_per_week?: number
          units?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workout_sessions: {
        Row: {
          active_zone_minutes: number | null
          avg_hr: number | null
          calories: number | null
          cardio_load: number | null
          completed_at: string | null
          created_at: string
          focus: string | null
          id: string
          is_sample: boolean
          kind: string
          max_hr: number | null
          notes: string | null
          perceived_effort: number | null
          scheduled_workout_id: string | null
          started_at: string
          status: string
          template_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_zone_minutes?: number | null
          avg_hr?: number | null
          calories?: number | null
          cardio_load?: number | null
          completed_at?: string | null
          created_at?: string
          focus?: string | null
          id?: string
          is_sample?: boolean
          kind?: string
          max_hr?: number | null
          notes?: string | null
          perceived_effort?: number | null
          scheduled_workout_id?: string | null
          started_at?: string
          status?: string
          template_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_zone_minutes?: number | null
          avg_hr?: number | null
          calories?: number | null
          cardio_load?: number | null
          completed_at?: string | null
          created_at?: string
          focus?: string | null
          id?: string
          is_sample?: boolean
          kind?: string
          max_hr?: number | null
          notes?: string | null
          perceived_effort?: number | null
          scheduled_workout_id?: string | null
          started_at?: string
          status?: string
          template_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_sessions_scheduled_workout_fk"
            columns: ["scheduled_workout_id"]
            isOneToOne: false
            referencedRelation: "scheduled_workouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_sessions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workout_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_sets: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          id: string
          is_warmup: boolean
          notes: string | null
          reps: number | null
          rest_seconds: number | null
          rpe: number | null
          session_exercise_id: string
          set_number: number
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          is_warmup?: boolean
          notes?: string | null
          reps?: number | null
          rest_seconds?: number | null
          rpe?: number | null
          session_exercise_id: string
          set_number?: number
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          is_warmup?: boolean
          notes?: string | null
          reps?: number | null
          rest_seconds?: number | null
          rpe?: number | null
          session_exercise_id?: string
          set_number?: number
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "workout_sets_session_exercise_id_fkey"
            columns: ["session_exercise_id"]
            isOneToOne: false
            referencedRelation: "session_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_templates: {
        Row: {
          category: string | null
          created_at: string
          environment: string | null
          estimated_minutes: number | null
          focus: string | null
          id: string
          is_system: boolean
          legacy_day_id: string | null
          level: string | null
          library_startable: boolean
          name: string
          notes: string | null
          release_gate: string
          requires_acknowledgment: boolean
          sort_order: number
          source_key: string | null
          source_name: string | null
          source_notes: Json
          source_version: number
          tags: string[]
          updated_at: string
          user_id: string | null
          warnings: Json
          workout_type: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          environment?: string | null
          estimated_minutes?: number | null
          focus?: string | null
          id?: string
          is_system?: boolean
          legacy_day_id?: string | null
          level?: string | null
          library_startable?: boolean
          name: string
          notes?: string | null
          release_gate?: string
          requires_acknowledgment?: boolean
          sort_order?: number
          source_key?: string | null
          source_name?: string | null
          source_notes?: Json
          source_version?: number
          tags?: string[]
          updated_at?: string
          user_id?: string | null
          warnings?: Json
          workout_type?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          environment?: string | null
          estimated_minutes?: number | null
          focus?: string | null
          id?: string
          is_system?: boolean
          legacy_day_id?: string | null
          level?: string | null
          library_startable?: boolean
          name?: string
          notes?: string | null
          release_gate?: string
          requires_acknowledgment?: boolean
          sort_order?: number
          source_key?: string | null
          source_name?: string | null
          source_notes?: Json
          source_version?: number
          tags?: string[]
          updated_at?: string
          user_id?: string | null
          warnings?: Json
          workout_type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_connect_iq_event: {
        Args: {
          _device_id: string
          _event_id: string
          _event_type: string
          _occurred_at: string
          _payload: Json
          _request_hash: string
          _session_id: string
          _set_id: string | null
          _user_id: string
        }
        Returns: Json
      }
      bootstrap_current_user: {
        Args: { _display_name?: string }
        Returns: undefined
      }
      exchange_device_pairing: {
        Args: {
          _code_hash: string
          _data_source_type?: string | null
          _device_label: string
          _platform: string
          _token_hash: string
        }
        Returns: {
          linked_device_id: string
          linked_label: string
          linked_user_id: string
        }[]
      }
      enroll_in_program: {
        Args: {
          _acknowledged?: boolean
          _program_id: string
          _training_days?: number[]
        }
        Returns: string
      }
      pause_program_enrollment: {
        Args: { _enrollment_id?: string }
        Returns: string
      }
      resume_program_enrollment: {
        Args: { _enrollment_id?: string }
        Returns: string
      }
      skip_current_program_workout: {
        Args: { _enrollment_id?: string; _reason?: string }
        Returns: string
      }
      start_assigned_workout: {
        Args: { _enrollment_id?: string }
        Returns: string
      }
      start_library_workout: {
        Args: { _acknowledged?: boolean; _template_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
