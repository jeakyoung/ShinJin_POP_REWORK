using Microsoft.Data.SqlClient;

namespace ShinJin.Pop.Api.Data;

public sealed class SqlConnectionFactory(IConfiguration configuration)
{
    public SqlConnection CreatePopConnection() => Create("Pop");

    public SqlConnection CreateErpConnection() => Create("Erp");

    private SqlConnection Create(string name)
    {
        var connectionString = configuration.GetConnectionString(name);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException($"ConnectionStrings:{name} is not configured.");
        }

        return new SqlConnection(connectionString);
    }
}
