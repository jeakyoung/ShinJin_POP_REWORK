package com.shinjin.pop.data;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class SqlConnectionFactory {
    private final Environment environment;

    public SqlConnectionFactory(Environment environment) {
        this.environment = environment;
    }

    public Connection openPopConnection() throws SQLException {
        return open("pop");
    }

    public Connection openErpConnection() throws SQLException {
        return open("erp");
    }

    private Connection open(String database) throws SQLException {
        String prefix = "shinjin.db." + database;
        String url = environment.getProperty(prefix + ".url");
        if (url == null || url.isBlank()) {
            throw new IllegalStateException(prefix + ".url is not configured");
        }

        String username = environment.getProperty(prefix + ".username");
        if (username == null || username.isBlank()) {
            return DriverManager.getConnection(url);
        }

        return DriverManager.getConnection(url, username, environment.getProperty(prefix + ".password", ""));
    }
}
