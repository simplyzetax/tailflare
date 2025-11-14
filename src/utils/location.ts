export const getLocationHint = (continent: ContinentCode): DurableObjectLocationHint => {
    let locationHint: DurableObjectLocationHint;
    switch (continent) {
        case "NA":
            locationHint = "wnam";
            break;
        case "EU":
            locationHint = "weur";
            break;
        case "AS":
            locationHint = "apac";
            break;
        case "OC":
            locationHint = "oc";
            break;
        case "AF":
            locationHint = "afr";
            break;
        case "SA":
            locationHint = "sam";
            break;
        default:
            locationHint = "weur";
            break;
    }

    return locationHint;
};