from run_system_integration_testing import cleanup_test_run, connect_database, TEST_RUN_ID


def main():
    conn = connect_database()
    try:
        cleanup_test_run(conn)
        print(f"Cleaned up {TEST_RUN_ID} records.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
