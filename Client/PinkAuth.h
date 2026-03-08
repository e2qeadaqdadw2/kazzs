#pragma once
#include <string>
#include <windows.h>
#include <iphlpapi.h>
#include <intrin.h>
#include <curl/curl.h>
#include <nlohmann/json.hpp>

#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "curl.lib")

using json = nlohmann::json;

class PinkAuth {
private:
    std::string api_url;
    std::string hwid;
    
    static size_t WriteCallback(void* contents, size_t size, size_t nmemb, std::string* output) {
        size_t total = size * nmemb;
        output->append((char*)contents, total);
        return total;
    }
    
    std::string GenerateHWID() {
        std::string hwid;
        
        DWORD serial = 0;
        GetVolumeInformationA("C:\\", NULL, 0, &serial, NULL, NULL, NULL, 0);
        hwid += std::to_string(serial);
        
        IP_ADAPTER_INFO adapterInfo[16];
        DWORD dwBufLen = sizeof(adapterInfo);
        if (GetAdaptersInfo(adapterInfo, &dwBufLen) == ERROR_SUCCESS) {
            PIP_ADAPTER_INFO adapter = adapterInfo;
            while (adapter) {
                if (adapter->Type == MIB_IF_TYPE_ETHERNET) {
                    for (UINT i = 0; i < adapter->AddressLength; i++) {
                        char hex[3];
                        sprintf_s(hex, "%02X", adapter->Address[i]);
                        hwid += hex;
                    }
                    break;
                }
                adapter = adapter->Next;
            }
        }
        
        int cpuInfo[4] = { -1 };
        __cpuid(cpuInfo, 0);
        hwid += std::to_string(cpuInfo[0]) + std::to_string(cpuInfo[1]);
        
        char computerName[MAX_COMPUTERNAME_LENGTH + 1];
        DWORD size = sizeof(computerName);
        GetComputerNameA(computerName, &size);
        hwid += computerName;
        
        return std::to_string(std::hash<std::string>{}(hwid));
    }
    
    std::string HttpRequest(const std::string& endpoint, const json& data) {
        CURL* curl = curl_easy_init();
        std::string response;
        
        if (curl) {
            std::string url = api_url + endpoint;
            std::string json_data = data.dump();
            
            struct curl_slist* headers = NULL;
            headers = curl_slist_append(headers, "Content-Type: application/json");
            
            curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_data.c_str());
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
            curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
            
            CURLcode res = curl_easy_perform(curl);
            curl_easy_cleanup(curl);
            curl_slist_free_all(headers);
            
            if (res != CURLE_OK) return "{\"success\":false,\"error\":\"Network error\"}";
        }
        
        return response;
    }

public:
    PinkAuth(const std::string& url) : api_url(url) {
        hwid = GenerateHWID();
    }
    
    bool Verify(const std::string& key, std::string& error_msg, std::string& type) {
        json data;
        data["key"] = key;
        data["hwid"] = hwid;
        data["ip"] = "0.0.0.0";
        
        std::string response = HttpRequest("/api/verify", data);
        
        try {
            json result = json::parse(response);
            if (result["success"].get<bool>()) {
                type = result["type"].get<std::string>();
                return true;
            } else {
                error_msg = result["error"].get<std::string>();
                return false;
            }
        } catch (...) {
            error_msg = "Error de autenticación";
            return false;
        }
    }
    
    std::string GetHWID() const { return hwid; }
};